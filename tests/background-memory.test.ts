import { test, expect } from "vitest";
import { BackgroundMemory } from "../packages/site-memory/background";

test("slow persistence does not block live work and queued observations coalesce", async () => {
  const jobs = new BackgroundMemory(),
    writes: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  jobs.schedule("active", async () => {
    await blocked;
    writes.push("active");
  });
  await Promise.resolve();
  jobs.schedule("page", async () => {
    writes.push("older");
  });
  jobs.schedule("page", async () => {
    writes.push("latest");
  });
  jobs.schedule("verified-edge", async () => {
    writes.push("verified");
  });
  expect(await Promise.resolve("live command")).toBe("live command");
  expect(writes).toEqual([]);
  release();
  await new Promise<void>((resolve) => {
    jobs.schedule("end", async () => {
      resolve();
    });
  });
  expect(writes).toEqual(["active", "latest", "verified"]);
});

test("Forget drains the current writer and discards queued writes before deleting", async () => {
  const jobs = new BackgroundMemory(),
    durable = new Set<string>();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  jobs.schedule("active", async () => {
    await blocked;
    durable.add("active");
  });
  await Promise.resolve();
  jobs.schedule("queued", async () => {
    durable.add("queued");
  });
  const deleted = jobs.cancelAndDrain().then(() => durable.clear());
  release();
  await deleted;
  expect([...durable]).toEqual([]);
  await new Promise<void>((resolve) => {
    jobs.schedule("new session", async () => {
      durable.add("fresh");
      resolve();
    });
  });
  expect([...durable]).toEqual(["fresh"]);
});
