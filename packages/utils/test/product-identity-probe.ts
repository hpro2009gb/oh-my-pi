import { APP_NAME, CONFIG_DIR_NAME, getConfigRootDir, getProjectAgentDir } from "../src/dirs";

process.stdout.write(
	JSON.stringify({
		APP_NAME,
		CONFIG_DIR_NAME,
		configRoot: getConfigRootDir(),
		projectDir: getProjectAgentDir("/tmp/proj"),
	}),
);
