import { access, cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      const outputHostingConfig = resolve(outputDirectory, "hosting.json");
      const outputDrizzle = resolve(outputDirectory, "drizzle");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");

      await mkdir(outputDirectory, { recursive: true });

      if (await exists(hostingConfig) && !(await exists(outputHostingConfig))) {
        await cp(hostingConfig, outputHostingConfig);
      }
      if (await exists(drizzleSource) && !(await exists(outputDrizzle))) {
        await cp(drizzleSource, outputDrizzle, { recursive: true });
      }
    },
  };
}
