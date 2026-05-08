import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MemorySaver } from "@langchain/langgraph";

type EncodedTuple<T extends unknown[]> = {
  values: T;
};

type PersistedCheckpointState = {
  storage: Record<string, Record<string, Record<string, EncodedTuple<[string, string, string | undefined]>>>>;
  writes: Record<string, Record<string, EncodedTuple<[string, string, string]>>>;
};

function encodeBytes(value: Uint8Array) {
  return Buffer.from(value).toString("base64");
}

function decodeBytes(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function encodeStorage(
  storage: MemorySaver["storage"],
): PersistedCheckpointState["storage"] {
  const output: PersistedCheckpointState["storage"] = {};
  for (const [threadId, namespaces] of Object.entries(storage)) {
    output[threadId] = {};
    for (const [namespace, checkpoints] of Object.entries(namespaces)) {
      output[threadId][namespace] = {};
      for (const [checkpointId, [checkpoint, metadata, parentCheckpointId]] of Object.entries(
        checkpoints,
      )) {
        output[threadId][namespace][checkpointId] = {
          values: [encodeBytes(checkpoint), encodeBytes(metadata), parentCheckpointId],
        };
      }
    }
  }
  return output;
}

function decodeStorage(
  storage: PersistedCheckpointState["storage"] | undefined,
): MemorySaver["storage"] {
  const output: MemorySaver["storage"] = {};
  for (const [threadId, namespaces] of Object.entries(storage ?? {})) {
    output[threadId] = {};
    for (const [namespace, checkpoints] of Object.entries(namespaces)) {
      output[threadId][namespace] = {};
      for (const [checkpointId, tuple] of Object.entries(checkpoints)) {
        const [checkpoint, metadata, parentCheckpointId] = tuple.values;
        output[threadId][namespace][checkpointId] = [
          decodeBytes(checkpoint),
          decodeBytes(metadata),
          parentCheckpointId,
        ];
      }
    }
  }
  return output;
}

function encodeWrites(writes: MemorySaver["writes"]): PersistedCheckpointState["writes"] {
  const output: PersistedCheckpointState["writes"] = {};
  for (const [threadAndCheckpoint, entries] of Object.entries(writes)) {
    output[threadAndCheckpoint] = {};
    for (const [key, [taskId, channel, value]] of Object.entries(entries)) {
      output[threadAndCheckpoint][key] = {
        values: [taskId, channel, encodeBytes(value)],
      };
    }
  }
  return output;
}

function decodeWrites(
  writes: PersistedCheckpointState["writes"] | undefined,
): MemorySaver["writes"] {
  const output: MemorySaver["writes"] = {};
  for (const [threadAndCheckpoint, entries] of Object.entries(writes ?? {})) {
    output[threadAndCheckpoint] = {};
    for (const [key, tuple] of Object.entries(entries)) {
      const [taskId, channel, value] = tuple.values;
      output[threadAndCheckpoint][key] = [taskId, channel, decodeBytes(value)];
    }
  }
  return output;
}

export class FileBackedMemorySaver extends MemorySaver {
  constructor(private readonly filePath: string) {
    super();
    this.load();
  }

  hasThread(threadId: string) {
    return Boolean(this.storage[threadId]);
  }

  async put(
    ...args: Parameters<MemorySaver["put"]>
  ): Promise<Awaited<ReturnType<MemorySaver["put"]>>> {
    const result = await super.put(...args);
    this.persist();
    return result;
  }

  async putWrites(
    ...args: Parameters<MemorySaver["putWrites"]>
  ): Promise<Awaited<ReturnType<MemorySaver["putWrites"]>>> {
    const result = await super.putWrites(...args);
    this.persist();
    return result;
  }

  async deleteThread(...args: Parameters<MemorySaver["deleteThread"]>) {
    const result = await super.deleteThread(...args);
    this.persist();
    return result;
  }

  async deleteThreadPrefix(threadPrefix: string) {
    let changed = false;
    for (const threadId of Object.keys(this.storage)) {
      if (threadId === threadPrefix || threadId.startsWith(threadPrefix)) {
        delete this.storage[threadId];
        changed = true;
      }
    }
    for (const key of Object.keys(this.writes)) {
      const threadId = parseWriteThreadId(key);
      if (threadId === threadPrefix || threadId.startsWith(threadPrefix)) {
        delete this.writes[key];
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  clearAll() {
    this.storage = {};
    this.writes = {};
    rmSync(this.filePath, { force: true });
  }

  private load() {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as PersistedCheckpointState;
      this.storage = decodeStorage(parsed.storage);
      this.writes = decodeWrites(parsed.writes);
    } catch {
      this.storage = {};
      this.writes = {};
    }
  }

  private persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(
      this.filePath,
      JSON.stringify({
        storage: encodeStorage(this.storage),
        writes: encodeWrites(this.writes),
      } satisfies PersistedCheckpointState),
      "utf8",
    );
  }
}

function parseWriteThreadId(key: string) {
  try {
    const parsed = JSON.parse(key) as unknown;
    return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : "";
  } catch {
    return "";
  }
}
