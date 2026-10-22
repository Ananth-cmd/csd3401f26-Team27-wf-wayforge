
import { execFile } from "child_process";
import path from "path";

// Locate the main Wayforge repository.
export const repoRoot = path.resolve(__dirname, "../../..");

// Locate the C++ engine executable.
const cliPath = path.join(
    repoRoot,
    "build/desktop/Sandbox/wf_cli/Debug/wf_cli.exe"
);

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
                    const message =
                        typeof result === "object" &&
                        result !== null &&
                        "error" in result &&
                        typeof result.error === "string"
                            ? result.error
                            : stderr.trim() || error.message;

                    reject(new Error(message));
                    return;
                }

                resolve(result);
            }
        );
    });
}
