import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("../../constants", () => ({
  LLM_PROVIDERS_CONFIG: [
    { id: "chatgpt", name: "ChatGPT" },
    { id: "claude", name: "Claude" },
    { id: "grok", name: "Grok" },
  ],
}));

jest.mock("../MarkdownDisplay", () => ({
  __esModule: true,
  default: ({ content }: any) => <div>{String(content || "")}</div>,
}));

const SingularityOutputView = require("./SingularityOutputView").default;

describe("SingularityOutputView provider selection", () => {
  test("selecting a provider with stored response pins it without recompute", async () => {
    const user = userEvent.setup();

    const setPinnedProvider = jest.fn();
    const onRecompute = jest.fn();

    const aiTurn: any = {
      type: "ai",
      id: "ai-1",
      userTurnId: "user-1",
      sessionId: "s-1",
      threadId: "t-1",
      createdAt: 0,
      meta: { singularity: "chatgpt" },
      singularity: { output: "Current response", timestamp: 1 },
      singularityResponses: {
        grok: [{ providerId: "grok", text: "Older response", status: "completed", createdAt: 1, updatedAt: 1 }],
      },
    };

    const singularityState: any = {
      output: { text: "Current response", providerId: "chatgpt", timestamp: 1 },
      isLoading: false,
      isError: false,
      providerId: "chatgpt",
      requestedProviderId: "chatgpt",
      setPinnedProvider,
    };

    render(
      <SingularityOutputView
        aiTurn={aiTurn}
        singularityState={singularityState}
        onRecompute={onRecompute}
      />,
    );

    await user.click(screen.getByRole("button", { name: /chatgpt/i }));
    await user.click(screen.getByRole("button", { name: /grok/i }));

    expect(setPinnedProvider).toHaveBeenCalledWith("grok");
    expect(onRecompute).not.toHaveBeenCalled();
  });

  test("selecting a provider without stored response triggers recompute", async () => {
    const user = userEvent.setup();

    const setPinnedProvider = jest.fn();
    const onRecompute = jest.fn();

    const aiTurn: any = {
      type: "ai",
      id: "ai-1",
      userTurnId: "user-1",
      sessionId: "s-1",
      threadId: "t-1",
      createdAt: 0,
      meta: { singularity: "chatgpt" },
      singularity: { output: "Current response", timestamp: 1 },
      singularityResponses: {},
    };

    const singularityState: any = {
      output: { text: "Current response", providerId: "chatgpt", timestamp: 1 },
      isLoading: false,
      isError: false,
      providerId: "chatgpt",
      requestedProviderId: "chatgpt",
      setPinnedProvider,
    };

    render(
      <SingularityOutputView
        aiTurn={aiTurn}
        singularityState={singularityState}
        onRecompute={onRecompute}
      />,
    );

    await user.click(screen.getByRole("button", { name: /chatgpt/i }));
    await user.click(screen.getByRole("button", { name: /claude/i }));

    expect(setPinnedProvider).not.toHaveBeenCalledWith("claude");
    expect(onRecompute).toHaveBeenCalledWith({ providerId: "claude" });
  });
});
