/*!
 * \file wfCli.ts
 * \brief Calls the native Wayforge C++ command-line engine.
 *
 * Finds the wf_cli executable, runs it with supplied arguments, parses JSON
 * responses, and separates structured engine errors from process failures.
 * This is the Node.js-to-C++ bridge used by the backend API.
 *
 * Links: server.ts; wf_cli executable
 *
 * \author Kervin Ong Guan Cheng
 * Contribution: Wayforge backend support and integration
 * AI declaration: ChatGPT assisted with refining documentation comments.
 * \date 2026-11-07
 */

import { execFile } from "child_process";
import path from "path";

// Locate the main Wayforge repository.
// Starting from src/services, move up to the main Wayforge repository.
export const repoRoot = path.resolve(__dirname, "../../..");

// Locate the C++ engine executable.
// On the team server set WF_CLI=/usr/local/bin/wf_cli (the Linux build).
const cliPath = process.env.WF_CLI || path.join(
    repoRoot,
    "build/desktop/Sandbox/wf_cli/Debug/wf_cli.exe"
);


/**
 * Represents an expected JSON error returned by wf_cli (ok: false).
 * The HTTP route handler can return this failure to the requester rather
 * than treating it as a connection or process crash.
 */
export class WfCliResponseError extends Error {

    constructor(
        public readonly details: {
            ok: false;
            error: string;
        }
    ) {
        super(details.error);
        this.name = "WfCliResponseError";
    }
}

// Run a Wayforge CLI command and return its JSON output.
/**
 * Run the native wf_cli executable with arguments and parse its JSON output.
 * The Promise resolves on a successful process exit and rejects on malformed
 * output, structured engine errors, timeouts, or launch failures.
 */
export function runWfCli(args: string[]): Promise<unknown> {

    return new Promise((resolve, reject) => {

        // execFile passes arguments separately without invoking a shell.
        // Limit runtime to 30 seconds and captured output to 5 MiB.
        execFile(
            cliPath,
            args,
            { timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
            (error, stdout, stderr) => {

                let result: unknown;

                try {
                    // Engine commands return JSON on stdout.
                    result = JSON.parse(stdout);
                } catch {
                    reject(new Error(
                        stderr.trim() || error?.message ||
                        "Invalid JSON returned by wf_cli"
                    ));
                    return;
                }

                
                if (error) {

                    // Check whether wf_cli returned a structured error.
                    if (
                        typeof result === "object" &&
                        result !== null &&
                        "ok" in result &&
                        result.ok === false &&
                        "error" in result &&
                        typeof result.error === "string"
                    ) {
                        reject(new WfCliResponseError({
                            ok: false,
                            error: result.error
                        }));
                        return;
                    }

                    // Other failures, such as a crashed executable.
                    reject(new Error(
                        stderr.trim() || error.message
                    ));
                    return;
                }


                // Process succeeded and its output is valid JSON.
                resolve(result);
            }
        );
    });
}
