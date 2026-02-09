import React from "react";
import { tokens } from "../styles/tokens";

const baseIcon =
  (fill: string) =>
    ({ size = 16, style = {} as React.CSSProperties } = {}) => (
      <div
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: 4,
          background: fill,
          ...style,
        }}
      />
    );

// Icons pull from tokens to keep Rail free of hard-coded color values
export const ChatGPTIcon = baseIcon(tokens.accents.chatgpt);
export const ClaudeIcon = baseIcon(tokens.accents.claude);
export const GeminiIcon = baseIcon(tokens.accents.gemini);
export const QwenIcon = baseIcon(tokens.accents.qwen);
export const GrokIcon = baseIcon(tokens.accents.grok);
