import { useState, useEffect } from "react";
import { getInitialEffectType, type EffectType } from "./settings-utils";

/**
 * 视觉效果类型 hook（共享）
 * 监听 localStorage 中 effectType 的变化，返回当前视觉效果类型
 * 用于各页面卡片根据设置应用毛玻璃/半透明效果
 */
export function useEffectType(): EffectType {
  const [effectType, setEffectType] = useState<EffectType>(() =>
    getInitialEffectType(),
  );

  useEffect(() => {
    const handleEffectTypeChange = () => {
      const stored = localStorage.getItem("effectType");
      if (
        stored === "frosted" ||
        stored === "translucent" ||
        stored === "none"
      ) {
        setEffectType(stored);
      }
    };
    window.addEventListener("effectTypeChanged", handleEffectTypeChange);
    return () => {
      window.removeEventListener("effectTypeChanged", handleEffectTypeChange);
    };
  }, []);

  return effectType;
}

/**
 * 根据视觉效果类型返回卡片样式类名
 * - frosted: 毛玻璃效果（backdrop-blur + 半透明背景）
 * - translucent: 仅半透明背景
 * - none: 不透明背景
 */
export function getCardClassName(
  effectType: EffectType,
  baseClassName = "bg-card",
): string {
  if (effectType === "frosted") {
    return `${baseClassName}/80 backdrop-blur-md`;
  }
  if (effectType === "translucent") {
    return `${baseClassName}/80`;
  }
  return baseClassName;
}
