import { homedir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { checkRequest, readJson, RequestError } from "../../../lib/server-security";
import { historyAction } from "../../../lib/history-store";

export async function POST(request: Request) {
  try {
    checkRequest(request);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)) {
      throw new RequestError("Geçmiş yalnızca yerel kurulumda kullanılabilir.", 403);
    }
    const path = process.env.HISTORY_DB_PATH || join(homedir(), ".ortak-akil", "evaluations.sqlite");
    const body = await readJson(request, 4 * 1024 * 1024);
    return historyAction(path, body);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof RequestError ? error.message : "Yerel geçmişe erişilemedi.",
    }, { status: error instanceof RequestError ? error.status : 500 });
  }
}
