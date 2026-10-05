import { describe, expect, it } from "vitest";
import { pickChatModels } from "../server/generate";

describe("pickChatModels", () => {
  it("keeps current chat families, drops dated snapshots and non-chat variants, and sorts", () => {
    const ids = ["whisper-1", "gpt-4o", "gpt-4o-2024-08-06", "gpt-4o-mini", "gpt-4o-mini-tts", "gpt-4o-realtime-preview", "gpt-4o-audio-preview",
      "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-5", "gpt-5-codex", "o3", "o4-mini", "o3-deep-research", "text-embedding-3-small", "dall-e-3", "gpt-3.5-turbo", "chatgpt-4o-latest"];
    expect(pickChatModels(ids)).toEqual(["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "gpt-5", "o3", "o4-mini"]);
  });

  it("offers new model families without a code change, but not legacy or non-chat ones", () => {
    const ids = ["gpt-6", "gpt-6-mini", "o5", "gpt-4", "gpt-4-turbo", "gpt-4-0613", "gpt-3.5-turbo", "o1-mini", "o1-preview", "o1", "gpt-image-1", "gpt-4o-transcribe", "gpt-5-search-api", "chatgpt-4o-latest", "sora-2"];
    expect(pickChatModels(ids)).toEqual(["gpt-6", "gpt-6-mini", "o1", "o5"]);
  });

  it("always keeps the default model when OpenAI lists it, and never invents one it doesn't", () => {
    expect(pickChatModels(["gpt-4o", "gpt-custom-x"], "gpt-custom-x")).toEqual(["gpt-4o", "gpt-custom-x"]);
    expect(pickChatModels(["gpt-4o"], "gpt-not-listed")).toEqual(["gpt-4o"]);
  });

  it("falls back to dated snapshots when they are all a key has, and de-duplicates", () => {
    expect(pickChatModels(["gpt-4o-2024-08-06", "gpt-4o-2024-08-06", "gpt-4o-2024-11-20"])).toEqual(["gpt-4o-2024-08-06", "gpt-4o-2024-11-20"]);
  });

  it("returns nothing when no compatible model is enabled", () => {
    expect(pickChatModels(["text-embedding-3-small", "whisper-1", "gpt-3.5-turbo"])).toEqual([]);
    expect(pickChatModels([])).toEqual([]);
  });
});
