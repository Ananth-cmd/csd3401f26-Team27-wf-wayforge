
import { execFile } from "child_process";
import path from "path";

// Locate the main Wayforge repository.
export const repoRoot = path.resolve(__dirname, "../../..");

// Locate the C++ engine executable.
const cliPath = path.join(
    repoRoot,
    "build/desktop/Sandbox/wf_cli/Debug/wf_cli.exe"
);


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
export function runWfCli(args: string[]): Promise<unknown> {

    return new Promise((resolve, reject) => {

        execFile(
            cliPath,
            args,
            { timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
            (error, stdout, stderr) => {

                let result: unknown;

                try {
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


                resolve(result);
            }
        );
    });
}
