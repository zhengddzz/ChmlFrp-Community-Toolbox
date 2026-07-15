// DNS 服务商抽象与实现
// 支持 DNSPod.cn（腾讯云 API 3.0）、DNSPod.com（Token）、Aliyun（HMAC-SHA1）
// 仅暴露 list_records 与 upsert_cname 两个高层接口，供 dns_monitor 调用
use base64::Engine;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;
type HmacSha1 = Hmac<Sha1>;

/// DNS 服务商类型
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DnsProviderKind {
    /// 国内腾讯云（DNSPod.cn，API 3.0 TC3-HMAC-SHA256）
    DnspodCn,
    /// 国际腾讯云（DNSPod.com，Token 鉴权）
    DnspodCom,
    /// 阿里云（HMAC-SHA1 RPC）
    Aliyun,
}

/// 一组 DNS 凭证（与一个服务商一一对应）
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsCredential {
    /// 唯一标识
    pub id: String,
    /// 用户自定义名称
    pub name: String,
    /// 服务商类型
    pub provider: DnsProviderKind,
    /// DNSPod.cn: SecretId；Aliyun: AccessKeyId
    #[serde(default)]
    pub secret_id: String,
    /// DNSPod.cn: SecretKey；Aliyun: AccessKeySecret
    #[serde(default)]
    pub secret_key: String,
    /// DNSPod.com: 格式 "ID,Token"
    #[serde(default)]
    pub token: String,
}

/// DNS 记录信息（用于查询现有记录）
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecord {
    pub record_id: String,
    pub record_type: String,
    pub name: String,
    pub value: String,
    pub line: String,
}

/// 高层接口：列出主域名下指定子域名前缀的所有记录
pub async fn list_records(
    cred: &DnsCredential,
    domain: &str,
    subdomain: Option<&str>,
) -> Result<Vec<DnsRecord>, String> {
    match cred.provider {
        DnsProviderKind::DnspodCn => dnspod_cn::list_records(cred, domain, subdomain).await,
        DnsProviderKind::DnspodCom => dnspod_com::list_records(cred, domain, subdomain).await,
        DnsProviderKind::Aliyun => aliyun::list_records(cred, domain, subdomain).await,
    }
}

/// 高层接口：确保子域名指向指定 CNAME 值（不存在则创建，存在则更新）
pub async fn upsert_cname(
    cred: &DnsCredential,
    domain: &str,
    subdomain: &str,
    cname_value: &str,
) -> Result<(), String> {
    match cred.provider {
        DnsProviderKind::DnspodCn => dnspod_cn::upsert_cname(cred, domain, subdomain, cname_value).await,
        DnsProviderKind::DnspodCom => dnspod_com::upsert_cname(cred, domain, subdomain, cname_value).await,
        DnsProviderKind::Aliyun => aliyun::upsert_cname(cred, domain, subdomain, cname_value).await,
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("ChmlFrpCommunityToolbox/1.3")
        // 不强制 no_proxy，让 reqwest 使用系统代理
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

// ===== 腾讯云 DNSPod.cn（API 3.0 TC3-HMAC-SHA256）=====
mod dnspod_cn {
    use super::*;
    use chrono::Utc;

    const HOST: &str = "dnspod.tencentcloudapi.com";
    const SERVICE: &str = "dnspod";
    const VERSION: &str = "2021-03-23";

    /// 调用一次腾讯云 API
    async fn call(
        cred: &DnsCredential,
        action: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let payload_str = serde_json::to_string(&payload).unwrap_or_default();
        let timestamp = Utc::now().timestamp();
        let date = Utc::now().format("%Y-%m-%d").to_string();

        // 1. 拼接规范请求串
        // 腾讯云规范要求 x-tc-action 的值为小写形式
        let action_lower = action.to_lowercase();
        let canonical_request = format!(
            "POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:{}\nx-tc-action:{}\n\ncontent-type;host;x-tc-action\n{}",
            HOST,
            action_lower,
            hex::encode(Sha256::digest(payload_str.as_bytes()))
        );

        // 2. 拼接签名串
        let credential_scope = format!("{}/{}/tc3_request", date, SERVICE);
        let string_to_sign = format!(
            "TC3-HMAC-SHA256\n{}\n{}\n{}",
            timestamp,
            credential_scope,
            hex::encode(Sha256::digest(canonical_request.as_bytes()))
        );

        // 3. 计算签名
        let secret_date = HmacSha256::new_from_slice(format!("TC3{}", cred.secret_key).as_bytes())
            .map_err(|e| format!("HMAC 初始化失败: {}", e))?
            .chain_update(date.as_bytes())
            .finalize()
            .into_bytes();
        let secret_service = HmacSha256::new_from_slice(&secret_date)
            .map_err(|e| format!("HMAC 初始化失败: {}", e))?
            .chain_update(SERVICE.as_bytes())
            .finalize()
            .into_bytes();
        let secret_signing = HmacSha256::new_from_slice(&secret_service)
            .map_err(|e| format!("HMAC 初始化失败: {}", e))?
            .chain_update(b"tc3_request")
            .finalize()
            .into_bytes();
        let signature = HmacSha256::new_from_slice(&secret_signing)
            .map_err(|e| format!("HMAC 初始化失败: {}", e))?
            .chain_update(string_to_sign.as_bytes())
            .finalize()
            .into_bytes();
        let signature_hex = hex::encode(signature);

        // 4. 构造 Authorization
        let authorization = format!(
            "TC3-HMAC-SHA256 Credential={}/{}, SignedHeaders=content-type;host;x-tc-action, Signature={}",
            cred.secret_id, credential_scope, signature_hex
        );

        let resp = http_client()?
            .post(format!("https://{}", HOST))
            .header("Authorization", authorization)
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Host", HOST)
            .header("X-TC-Action", action)
            .header("X-TC-Version", VERSION)
            .header("X-TC-Timestamp", timestamp.to_string())
            .body(payload_str)
            .send()
            .await
            .map_err(|e| format!("DNSPod.cn 请求失败: {}", e))?;

        let status = resp.status();
        let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
        if !status.is_success() {
            return Err(format!("DNSPod.cn HTTP {}: {}", status, body));
        }

        let value: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("解析响应失败: {} (body: {})", e, body))?;

        let resp_err = value.get("Response").and_then(|r| r.get("Error"));
        if let Some(err) = resp_err {
            let code = err.get("Code").and_then(|v| v.as_str()).unwrap_or("Unknown");
            let msg = err.get("Message").and_then(|v| v.as_str()).unwrap_or("");
            return Err(format!("DNSPod.cn 错误: {} - {}", code, msg));
        }
        Ok(value)
    }

    pub async fn list_records(
        cred: &DnsCredential,
        domain: &str,
        subdomain: Option<&str>,
    ) -> Result<Vec<DnsRecord>, String> {
        let mut payload = serde_json::json!({ "Domain": domain });
        if let Some(sub) = subdomain {
            payload["Subdomain"] = serde_json::Value::String(sub.to_string());
        }
        let resp = call(cred, "DescribeRecordList", payload).await?;
        let list = resp
            .get("Response")
            .and_then(|r| r.get("RecordList"))
            .and_then(|l| l.as_array())
            .cloned()
            .unwrap_or_default();

        let records = list
            .into_iter()
            .map(|item| DnsRecord {
                record_id: item.get("RecordId").and_then(|v| v.as_i64()).map(|i| i.to_string()).unwrap_or_default(),
                record_type: item.get("Type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: item.get("Name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                value: item.get("Value").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                line: item.get("Line").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            })
            .collect();
        Ok(records)
    }

    pub async fn upsert_cname(
        cred: &DnsCredential,
        domain: &str,
        subdomain: &str,
        cname_value: &str,
    ) -> Result<(), String> {
        let records = list_records(cred, domain, Some(subdomain)).await?;
        let existing = records.into_iter().find(|r| r.name == subdomain);

        if let Some(rec) = existing {
            if rec.record_type.eq_ignore_ascii_case("CNAME") && rec.value == cname_value {
                return Ok(());
            }
            let record_id: i64 = rec.record_id.parse().map_err(|_| "RecordId 解析失败".to_string())?;
            let payload = serde_json::json!({
                "Domain": domain,
                "RecordId": record_id,
                "SubDomain": subdomain,
                "RecordType": "CNAME",
                "RecordLine": "默认",
                "Value": cname_value,
            });
            call(cred, "ModifyRecord", payload).await?;
        } else {
            let payload = serde_json::json!({
                "Domain": domain,
                "SubDomain": subdomain,
                "RecordType": "CNAME",
                "RecordLine": "默认",
                "Value": cname_value,
            });
            call(cred, "CreateRecord", payload).await?;
        }
        Ok(())
    }
}

// ===== 国际 DNSPod.com（Token 鉴权）=====
mod dnspod_com {
    use super::*;

    const API_BASE: &str = "https://dnsapi.cn";

    async fn call(
        cred: &DnsCredential,
        path: &str,
        mut form: Vec<(&str, String)>,
    ) -> Result<serde_json::Value, String> {
        form.push(("login_token", cred.token.clone()));
        form.push(("format", "json".to_string()));

        let resp = http_client()?
            .post(format!("{}{}", API_BASE, path))
            .form(&form)
            .send()
            .await
            .map_err(|e| format!("DNSPod.com 请求失败: {}", e))?;

        let status = resp.status();
        let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
        if !status.is_success() {
            return Err(format!("DNSPod.com HTTP {}: {}", status, body));
        }

        let value: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("解析响应失败: {} (body: {})", e, body))?;

        let code = value.get("status").and_then(|s| s.get("code")).and_then(|c| c.as_i64()).unwrap_or(0);
        if code != 1 {
            let msg = value.get("status").and_then(|s| s.get("message")).and_then(|m| m.as_str()).unwrap_or("");
            return Err(format!("DNSPod.com 错误: {} - {}", code, msg));
        }
        Ok(value)
    }

    pub async fn list_records(
        cred: &DnsCredential,
        domain: &str,
        subdomain: Option<&str>,
    ) -> Result<Vec<DnsRecord>, String> {
        let mut form = vec![("domain", domain.to_string())];
        if let Some(sub) = subdomain {
            form.push(("sub_domain", sub.to_string()));
        }
        let resp = call(cred, "/Record.List", form).await?;
        let list = resp.get("records").and_then(|l| l.as_array()).cloned().unwrap_or_default();
        let records = list
            .into_iter()
            .map(|item| DnsRecord {
                record_id: item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                record_type: item.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                value: item.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                line: item.get("line").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            })
            .collect();
        Ok(records)
    }

    pub async fn upsert_cname(
        cred: &DnsCredential,
        domain: &str,
        subdomain: &str,
        cname_value: &str,
    ) -> Result<(), String> {
        let records = list_records(cred, domain, Some(subdomain)).await?;
        let existing = records.into_iter().find(|r| r.name == subdomain);

        if let Some(rec) = existing {
            if rec.record_type.eq_ignore_ascii_case("CNAME") && rec.value == cname_value {
                return Ok(());
            }
            let form = vec![
                ("domain", domain.to_string()),
                ("record_id", rec.record_id),
                ("sub_domain", subdomain.to_string()),
                ("record_type", "CNAME".to_string()),
                ("record_line", "默认".to_string()),
                ("value", cname_value.to_string()),
            ];
            call(cred, "/Record.Modify", form).await?;
        } else {
            let form = vec![
                ("domain", domain.to_string()),
                ("sub_domain", subdomain.to_string()),
                ("record_type", "CNAME".to_string()),
                ("record_line", "默认".to_string()),
                ("value", cname_value.to_string()),
            ];
            call(cred, "/Record.Create", form).await?;
        }
        Ok(())
    }
}

// ===== 阿里云 Aliyun（RPC + HMAC-SHA1）=====
mod aliyun {
    use super::*;
    use chrono::Utc;

    const API_BASE: &str = "https://alidns.aliyuncs.com";

    /// 计算阿里云 RPC 风格签名
    fn sign(params: &[(String, String)], secret_key: &str) -> String {
        // 按 key 字典序升序排序后拼接 canonicalized_query
        let mut sorted = params.to_vec();
        sorted.sort_by(|a, b| a.0.cmp(&b.0));
        let canonicalized: String = sorted
            .into_iter()
            .map(|(k, v)| {
                format!(
                    "{}={}",
                    percent_encode(&k),
                    percent_encode(&v)
                )
            })
            .collect::<Vec<_>>()
            .join("&");
        let string_to_sign = format!("GET&{}&{}", percent_encode("/"), percent_encode(&canonicalized));
        let mut mac = HmacSha1::new_from_slice(format!("{}&", secret_key).as_bytes())
            .expect("HMAC-SHA1 初始化失败");
        mac.update(string_to_sign.as_bytes());
        base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
    }

    fn percent_encode(s: &str) -> String {
        use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
        const RESERVED: &AsciiSet = &CONTROLS
            .add(b' ').add(b'!').add(b'"').add(b'#').add(b'$').add(b'%').add(b'&').add(b'\'')
            .add(b'(').add(b')').add(b'*').add(b'+').add(b',').add(b'/').add(b':').add(b';')
            .add(b'<').add(b'=').add(b'>').add(b'?').add(b'@').add(b'[').add(b'\\').add(b']')
            .add(b'^').add(b'`').add(b'{').add(b'|').add(b'}');
        utf8_percent_encode(s, RESERVED).to_string()
    }

    async fn call(
        cred: &DnsCredential,
        action: &str,
        mut params: Vec<(String, String)>,
    ) -> Result<serde_json::Value, String> {
        params.push(("Format".to_string(), "JSON".to_string()));
        params.push(("Version".to_string(), "2015-01-09".to_string()));
        params.push(("AccessKeyId".to_string(), cred.secret_id.clone()));
        params.push(("SignatureMethod".to_string(), "HMAC-SHA1".to_string()));
        params.push(("SignatureVersion".to_string(), "1.0".to_string()));
        params.push(("SignatureNonce".to_string(), uuid_v4()));
        params.push(("Timestamp".to_string(), Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()));
        params.push(("Action".to_string(), action.to_string()));

        let signature = sign(&params, &cred.secret_key);
        params.push(("Signature".to_string(), signature));

        let query: String = params
            .into_iter()
            .map(|(k, v)| format!("{}={}", percent_encode(&k), percent_encode(&v)))
            .collect::<Vec<_>>()
            .join("&");

        let resp = http_client()?
            .get(format!("{}?{}", API_BASE, query))
            .send()
            .await
            .map_err(|e| format!("Aliyun 请求失败: {}", e))?;

        let status = resp.status();
        let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
        if !status.is_success() {
            return Err(format!("Aliyun HTTP {}: {}", status, body));
        }

        let value: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("解析响应失败: {} (body: {})", e, body))?;

        if let Some(err) = value.get("Code").and_then(|c| c.as_str()) {
            if !err.is_empty() && err != "0" {
                let msg = value.get("Message").and_then(|m| m.as_str()).unwrap_or("");
                return Err(format!("Aliyun 错误: {} - {}", err, msg));
            }
        }
        Ok(value)
    }

    fn uuid_v4() -> String {
        // 简易随机串作为 SignatureNonce
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        format!("{:x}", nanos)
    }

    pub async fn list_records(
        cred: &DnsCredential,
        domain: &str,
        subdomain: Option<&str>,
    ) -> Result<Vec<DnsRecord>, String> {
        let mut params = vec![("DomainName".to_string(), domain.to_string())];
        if let Some(sub) = subdomain {
            let full = if sub.is_empty() { domain.to_string() } else { format!("{}.{}", sub, domain) };
            params.push(("RRKeyWord".to_string(), full));
        }
        let resp = call(cred, "DescribeDomainRecords", params).await?;
        let list = resp.get("DomainRecords").and_then(|d| d.get("Record")).and_then(|r| r.as_array()).cloned().unwrap_or_default();
        let records = list
            .into_iter()
            .map(|item| DnsRecord {
                record_id: item.get("RecordId").and_then(|v| v.as_i64()).map(|i| i.to_string()).unwrap_or_default(),
                record_type: item.get("Type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: item.get("RR").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                value: item.get("Value").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                line: item.get("Line").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            })
            .collect();
        Ok(records)
    }

    pub async fn upsert_cname(
        cred: &DnsCredential,
        domain: &str,
        subdomain: &str,
        cname_value: &str,
    ) -> Result<(), String> {
        let records = list_records(cred, domain, Some(subdomain)).await?;
        let target_full = if subdomain.is_empty() { domain.to_string() } else { format!("{}.{}", subdomain, domain) };
        let existing = records.into_iter().find(|r| {
            let full = if r.name.is_empty() { domain.to_string() } else { format!("{}.{}", r.name, domain) };
            full == target_full
        });

        if let Some(rec) = existing {
            if rec.record_type.eq_ignore_ascii_case("CNAME") && rec.value == cname_value {
                return Ok(());
            }
            let params = vec![
                ("RecordId".to_string(), rec.record_id),
                ("RR".to_string(), subdomain.to_string()),
                ("Type".to_string(), "CNAME".to_string()),
                ("Value".to_string(), cname_value.to_string()),
            ];
            call(cred, "UpdateDomainRecord", params).await?;
        } else {
            let params = vec![
                ("DomainName".to_string(), domain.to_string()),
                ("RR".to_string(), subdomain.to_string()),
                ("Type".to_string(), "CNAME".to_string()),
                ("Value".to_string(), cname_value.to_string()),
            ];
            call(cred, "AddDomainRecord", params).await?;
        }
        Ok(())
    }
}
