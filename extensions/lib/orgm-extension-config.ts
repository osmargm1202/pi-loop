import type { OrgmExtensionConfig, OrgmExtensionsConfig, OrgmHostConfig } from "./orgm-config.ts";
import { loadOrgmConfig, loadOrgmConfigSlice, saveOrgmConfigSlice } from "./orgm-config.ts";

export type OrgmExtensionAction = "on" | "off" | "toggle" | "status";
export type OrgmExtensionCommand = {
	extension?: string;
	feature?: string;
	action: OrgmExtensionAction;
	error?: string;
};
export type CompletionItem = { value: string; label: string };

const ACTIONS: OrgmExtensionAction[] = ["on", "off", "toggle", "status"];
const ACTION_ALIASES = new Map<string, OrgmExtensionAction>([
	["enable", "on"],
	["enabled", "on"],
	["true", "on"],
	["disable", "off"],
	["disabled", "off"],
	["false", "off"],
	["show", "status"],
	["state", "status"],
]);
const FEATURE_ALIASES = new Map<string, string>([
	["question", "questions"],
	["questions", "questions"],
	["permission", "permissions"],
	["permissions", "permissions"],
	["perm", "permissions"],
	["perms", "permissions"],
]);

export const KNOWN_ORGM_EXTENSION_FEATURES: Record<string, string[]> = {
	ask: ["questions", "permissions"],
	ask_user_question: ["questions"],
	ask_user_permission: ["permissions"],
	askAsk: ["questions", "permissions"],
	ask_ask: ["questions", "permissions"],
	askUser: ["questions", "permissions"],
	ask_user: ["questions", "permissions"],
	askUserQuestion: ["questions"],
	ask_user_question: ["questions"],
	askUserPermission: ["permissions"],
	ask_user_permission: ["permissions"],
	todo: [],
	awareness: [],
	sessions: [],
	minimal: ["skills"],
	"agent-status": ["widget", "model", "tokens", "cost", "persistence", "summary", "activity"],
	subagents: [],
	clear: [],
	title: ["auto"],
	notify: ["questions", "permissions", "done"],
	git: [],
	limit: [],
	orgm: [],
};

export const KNOWN_ORGM_EXTENSIONS = Object.keys(KNOWN_ORGM_EXTENSION_FEATURES);

function normalizeToken(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeAction(value: string | undefined): OrgmExtensionAction | undefined {
	if (!value) return undefined;
	const normalized = normalizeToken(value);
	if (ACTIONS.includes(normalized as OrgmExtensionAction)) return normalized as OrgmExtensionAction;
	return ACTION_ALIASES.get(normalized);
}

function normalizeFeature(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const normalized = normalizeToken(value);
	return FEATURE_ALIASES.get(normalized) ?? normalized;
}

export function resolveOrgmExtensionConfig(config: OrgmHostConfig | undefined, extensionName: string, featureName?: string): { enabled: boolean } {
	const extension = config?.extensions?.[extensionName];
	if (extensionName === "ask") {
		const askFeatureEnabled = (name: string): boolean => {
			const normalized = normalizeFeature(name) ?? name;
			const defaultFeatureEnabled = normalized === "permissions" ? false : true;
			return extension?.features?.[normalized]?.enabled ?? defaultFeatureEnabled;
		};
		if (featureName) return { enabled: askFeatureEnabled(featureName) };
		return { enabled: askFeatureEnabled("questions") || askFeatureEnabled("permissions") };
	}
	const extensionEnabled = extension?.enabled ?? true;
	if (!featureName) return { enabled: extensionEnabled };
	const feature = extension?.features?.[normalizeFeature(featureName) ?? featureName];
	return { enabled: extensionEnabled && (feature?.enabled ?? true) };
}

export function isOrgmExtensionEnabled(extensionName: string, config?: OrgmHostConfig, featureName?: string): boolean {
	return resolveOrgmExtensionConfig(config ?? loadOrgmConfig(), extensionName, featureName).enabled;
}

function cloneExtensionConfig(input: OrgmExtensionConfig | undefined, extensionName: string): OrgmExtensionConfig {
	return {
		enabled: input?.enabled ?? true,
		features: Object.fromEntries(
			Object.entries(input?.features ?? {}).map(([name, feature]) => [name, { enabled: feature.enabled }]),
		),
	};
}

export function setOrgmExtensionFeature(extensionName: string, featureName: string | undefined, enabled: boolean, configPath?: string): OrgmExtensionsConfig {
	const current = loadOrgmConfigSlice("extensions", configPath);
	const extension = cloneExtensionConfig(current[extensionName], extensionName);
	if (extensionName === "ask") extension.enabled = true;
	if (!featureName) {
		if (extensionName === "ask") {
			const featureNames = new Set(["questions", "permissions", ...Object.keys(extension.features)]);
			extension.features = Object.fromEntries(Array.from(featureNames).map((name) => [name, { enabled }]));
		} else {
			extension.enabled = enabled;
		}
	} else {
		const normalizedFeature = normalizeFeature(featureName) ?? featureName;
		extension.features = { ...extension.features, [normalizedFeature]: { enabled } };
	}
	const next = { ...current, [extensionName]: extension };
	saveOrgmConfigSlice("extensions", next, configPath);
	return next;
}

export function parseOrgmExtensionCommand(args: string): OrgmExtensionCommand | undefined {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return undefined;
	const extension = tokens[0]!;
	if (tokens.length === 1) return { extension, action: "status" };
	if (tokens.length === 2) {
		const maybeAction = normalizeAction(tokens[1]);
		if (maybeAction) return { extension, action: maybeAction };
		return { extension, feature: normalizeFeature(tokens[1]), action: "status" };
	}
	const action = normalizeAction(tokens[2]);
	if (!action) return { extension, feature: normalizeFeature(tokens[1]), action: "status", error: `Unknown action: ${tokens[2]}` };
	return { extension, feature: normalizeFeature(tokens[1]), action };
}

function completionValues(): CompletionItem[] {
	const values: CompletionItem[] = [];
	for (const extension of KNOWN_ORGM_EXTENSIONS) {
		for (const action of ACTIONS) values.push({ value: `${extension} ${action}`, label: `${extension} ${action}` });
		for (const feature of KNOWN_ORGM_EXTENSION_FEATURES[extension] ?? []) {
			for (const action of ACTIONS) values.push({ value: `${extension} ${feature} ${action}`, label: `${extension} ${feature} ${action}` });
		}
	}
	return values;
}

export function buildOrgmExtensionCommandCompletions(prefix: string): CompletionItem[] {
	const normalized = prefix.trim().toLowerCase();
	return completionValues().filter((item) => item.value.startsWith(normalized)).slice(0, 80);
}

export function describeOrgmExtensionStatus(extensionName: string, config = loadOrgmConfig()): string {
	const extension = config.extensions[extensionName];
	const enabled = resolveOrgmExtensionConfig(config, extensionName).enabled;
	const features = new Set([...(KNOWN_ORGM_EXTENSION_FEATURES[extensionName] ?? []), ...Object.keys(extension?.features ?? {})]);
	const featureText = Array.from(features)
		.map((feature) => `${feature}:${resolveOrgmExtensionConfig(config, extensionName, feature).enabled ? "on" : "off"}`)
		.join(" ");
	return `${extensionName}: ${enabled ? "on" : "off"}${featureText ? ` · ${featureText}` : ""}`;
}
