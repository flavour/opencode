import type { Argv } from "yargs"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { bootstrap } from "../bootstrap"
import { Locale } from "../../util/locale"
import { EOL } from "os"

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) => yargs.command(SessionListCommand).demandCommand(),
  async handler() {},
})

export const SessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs: Argv) => {
    return yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running opencode server (e.g., http://localhost:4096)",
      })
      .option("server-dir", {
        type: "string",
        describe: "directory to run in on the server (absolute path)",
      })
  },
  handler: async (args) => {
    const sessions = await listSessions({
      attach: args.attach,
      directory: args.serverDir,
    })

    const roots = sessions.filter((s) => !s.parentID).toSorted((a, b) => b.time.updated - a.time.updated)

    const limitedSessions = args.maxCount ? roots.slice(0, args.maxCount) : roots

    if (limitedSessions.length === 0) {
      return
    }

    const output = args.format === "json" ? formatSessionJSON(limitedSessions) : formatSessionTable(limitedSessions)

    const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

    if (!shouldPaginate) {
      console.log(output)
      return
    }

    const proc = Bun.spawn({
      cmd: ["less", "-R", "-S"],
      stdin: "pipe",
      stdout: "inherit",
      stderr: "inherit",
    })

    proc.stdin.write(output)
    proc.stdin.end()
    await proc.exited
  },
})

type SessionItem = {
  id: string
  title: string
  parentID?: string
  projectID: string
  directory: string
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
}

async function listSessions(input: { attach?: string; directory?: string }) {
  if (input.attach) {
    const url = new URL(input.attach)
    const queryDir = url.searchParams.get("directory") || undefined
    url.search = ""

    const sdk = createOpencodeClient({
      baseUrl: url.toString(),
      directory: input.directory || queryDir,
    })

    const result = await sdk.session.list()
    return (result.data ?? []) as SessionItem[]
  }

  return bootstrap(process.cwd(), async () => {
    const sessions: SessionItem[] = []
    for await (const session of Session.list()) {
      sessions.push(session)
    }
    return sessions
  })
}

function formatSessionTable(sessions: SessionItem[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: SessionItem[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
