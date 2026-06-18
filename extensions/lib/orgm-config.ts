import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

export type OrgmModeName = "pi" | "plan" | "build" | "ask" | "sdd" | "tdd" | string;

export interface OrgmModeConfig {
	defaultMode: OrgmModeName;
	allowedModes: OrgmModeName[];
}

export interface OrgmGitConfig {
	autoInit: boolean;
	autoCommitCompletedWork: boolean;
	preferWorktreesForLongWork: boolean;
	ignoreRoots: string[];
}

export interface OrgmTitleConfig {
	autoGenerate: boolean;
}

export interface OrgmMinimalSkillsConfig {
	enabled: boolean;
}

export interface OrgmAgentStatusConfig {
	showWidget: boolean;
	showModel: boolean;
	showTokens: boolean;
	showCost: boolean;
	showPersistence: boolean;
	showSummary: boolean;
	showActivity: boolean;
}

export type OrgmExtensionFeatureConfig = { enabled: boolean };
export type OrgmExtensionConfig = {
	enabled: boolean;
	features: Record<string, OrgmExtensionFeatureConfig>;
};
export type OrgmExtensionsConfig = Record<string, OrgmExtensionConfig>;
export type OrgmAgentModelsConfig = Record<string, string>;

export interface OrgmHostConfig {
	mode: OrgmModeConfig;
	git: OrgmGitConfig;
	title: OrgmTitleConfig;
	minimalSkills: OrgmMinimalSkillsConfig;
	agentStatus: OrgmAgentStatusConfig;
	extensions: OrgmExtensionsConfig;
	agentModels: OrgmAgentModelsConfig;
}

export const DEFAULT_MODE_ORDER = ["pi", "plan", "build", "ask", "sdd", "tdd"] as const;

export const DEFAULT_ORGM_CONFIG: OrgmHostConfig = {
	mode: {
		defaultMode: "pi",
		allowedModes: [...DEFAULT_MODE_ORDER],
	},
	git: {
		autoInit: false,
		autoCommitCompletedWork: false,
		preferWorktreesForLongWork: true,
		ignoreRoots: ["~", "~/Nextcloud", "~/Nextcloud/**"],
	},
	title: {
		autoGenerate: true,
	},
	minimalSkills: {
		enabled: true,
	},
	agentStatus: {
		showWidget: true,
		showModel: true,
		showTokens: true,
		showCost: false,
		showPersistence: true,
		showSummary: true,
		showActivity: true,
	},
	extensions: {
		ask: {
			enabled: true,
			features: {
				questions: { enabled: true },
				permissions: { enabled: false },
			},
		},
		todo: { enabled: true, features: {} },
	},
	agentModels: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return [...fallback];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const clean = item.trim();
		if (clean && !out.includes(clean)) out.push(clean);
	}
	return out.length > 0 ? out : [...fallback];
}

function mergeModeConfig(value: unknown): OrgmModeConfig {
	const raw = isRecord(value) ? value : {};
	const allowedModes = uniqueStrings(raw.allowedModes, DEFAULT_ORGM_CONFIG.mode.allowedModes);
	const requestedDefault = typeof raw.defaultMode === "string" && raw.defaultMode.trim() ? raw.defaultMode.trim() : DEFAULT_ORGM_CONFIG.mode.defaultMode;
	return {
		defaultMode: allowedModes.includes(requestedDefault) ? requestedDefault : DEFAULT_ORGM_CONFIG.mode.defaultMode,
		allowedModes,
	};
}

function mergeGitConfig(value: unknown): OrgmGitConfig {
	const raw = isRecord(value) ? value : {};
	return {
		autoInit: typeof raw.autoInit === "boolean" ? raw.autoInit : DEFAULT_ORGM_CONFIG.git.autoInit,
		autoCommitCompletedWork: typeof raw.autoCommitCompletedWork === "boolean"
			? raw.autoCommitCompletedWork
			: DEFAULT_ORGM_CONFIG.git.autoCommitCompletedWork,
		preferWorktreesForLongWork: typeof raw.preferWorktreesForLongWork === "boolean"
			? raw.preferWorktreesForLongWork
			: DEFAULT_ORGM_CONFIG.git.preferWorktreesForLongWork,
		ignoreRoots: Array.isArray(raw.ignoreRoots)
			? raw.ignoreRoots.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
			: [...DEFAULT_ORGM_CONFIG.git.ignoreRoots],
	};
}

function mergeTitleConfig(value: unknown): OrgmTitleConfig {
	const raw = isRecord(value) ? value : {};
	return {
		autoGenerate: typeof raw.autoGenerate === "boolean" ? raw.autoGenerate : DEFAULT_ORGM_CONFIG.title.autoGenerate,
	};
}

export function mergeMinimalSkillsConfig(value: unknown): OrgmMinimalSkillsConfig {
	const raw = isRecord(value) ? value : {};
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_ORGM_CONFIG.minimalSkills.enabled,
	};
}

export function mergeAgentStatusConfig(value: unknown): OrgmAgentStatusConfig {
	const raw = isRecord(value) ? value : {};
	return {
		showWidget: typeof raw.showWidget === "boolean" ? raw.showWidget : DEFAULT_ORGM_CONFIG.agentStatus.showWidget,
		showModel: typeof raw.showModel === "boolean" ? raw.showModel : DEFAULT_ORGM_CONFIG.agentStatus.showModel,
		showTokens: typeof raw.showTokens === "boolean" ? raw.showTokens : DEFAULT_ORGM_CONFIG.agentStatus.showTokens,
		showCost: typeof raw.showCost === "boolean" ? raw.showCost : DEFAULT_ORGM_CONFIG.agentStatus.showCost,
		showPersistence: typeof raw.showPersistence === "boolean" ? raw.showPersistence : DEFAULT_ORGM_CONFIG.agentStatus.showPersistence,
		showSummary: typeof raw.showSummary === "boolean" ? raw.showSummary : DEFAULT_ORGM_CONFIG.agentStatus.showSummary,
		showActivity: typeof raw.showActivity === "boolean" ? raw.showActivity : DEFAULT_ORGM_CONFIG.agentStatus.showActivity,
	};
}

function mergeExtensionFeatureConfig(value: unknown, fallback: OrgmExtensionFeatureConfig = { enabled: true }): OrgmExtensionFeatureConfig {
	const raw = isRecord(value) ? value : {};
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
	};
}

function mergeExtensionConfig(value: unknown, fallback: OrgmExtensionConfig = { enabled: true, features: {} }): OrgmExtensionConfig {
	const raw = isRecord(value) ? value : {};
	const rawFeatures = isRecord(raw.features) ? raw.features : {};
	const featureNames = new Set([
		...Object.keys(fallback.features),
		...Object.keys(rawFeatures),
		...Object.entries(raw)
			.filter(([key, nested]) => key !== "enabled" && key !== "features" && isRecord(nested))
			.map(([key]) => key),
	]);
	const features: Record<string, OrgmExtensionFeatureConfig> = {};
	for (const featureName of featureNames) {
		const rawValue = rawFeatures[featureName] ?? raw[featureName];
		features[featureName] = mergeExtensionFeatureConfig(rawValue, fallback.features[featureName]);
	}
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
		features,
	};
}

export function mergeExtensionsConfig(value: unknown): OrgmExtensionsConfig {
	const raw = isRecord(value) ? value : {};
	const extensionNames = new Set([...Object.keys(DEFAULT_ORGM_CONFIG.extensions), ...Object.keys(raw)]);
	const extensions: OrgmExtensionsConfig = {};
	for (const extensionName of extensionNames) {
		extensions[extensionName] = mergeExtensionConfig(raw[extensionName], DEFAULT_ORGM_CONFIG.extensions[extensionName]);
	}
	return extensions;
}

export function mergeAgentModelsConfig(value: unknown): OrgmAgentModelsConfig {
	if (!isRecord(value)) return { ...DEFAULT_ORGM_CONFIG.agentModels };
	return Object.fromEntries(
		Object.entries(value)
			.filter(([agentName, model]) => agentName.trim().length > 0 && typeof model === "string" && model.trim().length > 0)
			.map(([agentName, model]) => [agentName.trim(), model.trim()]),
	);
}

const KNOWN_ORGM_CONFIG_KEYS = [
	"mode",
	"git",
	"title",
	"minimalSkills",
	"agentStatus",
	"extensions",
	"agentModels",
] as const;

const REMOVED_ORGM_CONFIG_KEYS = new Set(["caveman", "defaultPrimaryAgent", "flows", "primaryAuto", "repoTree"]);

function preserveUnknownTopLevelValues(raw: Record<string, unknown>): Record<string, unknown> {
	const next: Record<string, unknown> = { ...raw };
	for (const key of KNOWN_ORGM_CONFIG_KEYS) delete next[key];
	for (const key of REMOVED_ORGM_CONFIG_KEYS) delete next[key];
	return next;
}

function mergeOrgmConfig(raw: Record<string, unknown>): OrgmHostConfig {
	const unknownTopLevel = preserveUnknownTopLevelValues(raw);
	return {
		...(unknownTopLevel as OrgmHostConfig),
		mode: mergeModeConfig(raw.mode),
		git: mergeGitConfig(raw.git),
		title: mergeTitleConfig(raw.title),
		minimalSkills: mergeMinimalSkillsConfig(raw.minimalSkills),
		agentStatus: mergeAgentStatusConfig(raw.agentStatus),
		extensions: mergeExtensionsConfig(raw.extensions),
		agentModels: mergeAgentModelsConfig(raw.agentModels),
	};
}

export function expandHomePath(path: string, home = homedir()): string {
	if (path === "~") return home;
	if (path.startsWith("~/")) return join(home, path.slice(2));
	return path;
}

export function normalizeFsPath(path: string, base = process.cwd(), home = homedir()): string {
	const expanded = expandHomePath(path, home);
	return normalize(isAbsolute(expanded) ? expanded : resolve(base, expanded));
}

export function isBlockedGitRoot(cwd: string, ignoreRoots = DEFAULT_ORGM_CONFIG.git.ignoreRoots, home = homedir()): boolean {
	const current = normalizeFsPath(cwd, process.cwd(), home);
	for (const root of ignoreRoots) {
		const isGlobChildren = root.endsWith("/**");
		const withoutGlob = isGlobChildren ? root.slice(0, -3) : root;
		const normalizedRoot = normalizeFsPath(withoutGlob, process.cwd(), home);
		if (isGlobChildren) {
			if (current === normalizedRoot || current.startsWith(`${normalizedRoot}/`)) return true;
			continue;
		}
		if (current === normalizedRoot) return true;
	}
	return false;
}

export function orgmConfigPath(home = process.env.HOME ?? homedir()): string {
	return join(home, ".pi", "agent", "orgm.json");
}

export type OrgmConfigSliceKey = keyof OrgmHostConfig;
export type WritableOrgmConfigSliceKey = keyof Pick<OrgmHostConfig, "mode" | "minimalSkills" | "agentStatus" | "extensions" | "agentModels" | "title">;

export function loadOrgmConfig(configPath = orgmConfigPath()): OrgmHostConfig {
	if (!existsSync(configPath)) return structuredClone(DEFAULT_ORGM_CONFIG);
	try {
		const raw = JSON.parse(readFileSync(configPath, "utf8"));
		if (!isRecord(raw)) return structuredClone(DEFAULT_ORGM_CONFIG);
		return mergeOrgmConfig(raw);
	} catch {
		return structuredClone(DEFAULT_ORGM_CONFIG);
	}
}

export function loadOrgmConfigSlice<K extends OrgmConfigSliceKey>(slice: K, configPath = orgmConfigPath()): OrgmHostConfig[K] {
	return structuredClone(loadOrgmConfig(configPath)[slice]);
}

export function initializeOrgmConfig(configPath = orgmConfigPath()): OrgmHostConfig {
	const initialized = loadOrgmConfig(configPath);
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, `${JSON.stringify(initialized, null, 2)}\n`, "utf8");
	return structuredClone(initialized);
}

export function saveOrgmConfigSlice<K extends WritableOrgmConfigSliceKey>(
	slice: K,
	value: OrgmHostConfig[K],
	configPath = orgmConfigPath(),
): void {
	let raw: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8"));
		if (isRecord(parsed)) raw = parsed;
	} catch {
		raw = {};
	}
	mkdirSync(dirname(configPath), { recursive: true });
	for (const key of REMOVED_ORGM_CONFIG_KEYS) delete raw[key];
	writeFileSync(configPath, `${JSON.stringify({ ...raw, [slice]: value }, null, 2)}\n`, "utf8");
}
