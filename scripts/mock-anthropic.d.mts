import type { Server } from "node:http";

export type MockCall = { id: string; tool: string; input: Record<string, unknown>; prompt: string };
export type MockResult = { id: string; tool: string; ok: boolean; content: string };
export type MockReport = {
  requests: number;
  errors: string[];
  calls: MockCall[];
  results: MockResult[];
  memory: string[];
  systemOk: boolean;
  lastModel: string;
};

export const SCRIPTS: Record<string, unknown[]>;
export function newReport(): MockReport;
export function validate(req: unknown, headers: Record<string, string | string[] | undefined>): void;
export function respond(req: unknown, report: MockReport): unknown;
export function startMockAnthropic(port?: number): Promise<{ server: Server; port: number; report: () => MockReport }>;
