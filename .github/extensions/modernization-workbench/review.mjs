import { fail } from "./common.mjs";

export const reviewGoals = ["Understand the app", "Review upgrade readiness", "Review cloud readiness"];

export function reviewFields(data) {
    for (const key of ["reviewContexts", "sourceBindings"]) {
        if (data[key] !== undefined && !Array.isArray(data[key])) fail("invalid_store", `Stored ${key} is invalid; it was not reset.`, 500);
    }
    return {
        reviewContexts: data.reviewContexts ?? [],
        sourceBindings: data.sourceBindings ?? [],
        activeReviewContextId: data.activeReviewContextId ?? null,
    };
}

export function readinessCards(capabilities) {
    return [
        { id: "review", title: "Local report review", status: "available", detail: "Import and inspect supported reports without running native tools or AI.", observation: "Local capability", observedAt: null },
        { id: "confirmation", title: "Native confirmation", status: capabilities.approvals ? "available" : "unavailable", detail: capabilities.approvals ? "This host can request explicit approval for current-source previews and existing run actions." : "Current-source access and native jobs are blocked. Report evidence remains available.", observation: "Current host capability", observedAt: null },
        { id: "java", title: "Java assessment requests", status: capabilities.nativeRuns ? "not_rechecked" : "unavailable", detail: capabilities.nativeRuns ? "The existing request flow is available. Native tool health has not been checked in this session." : "The existing native request prerequisites are unavailable.", observation: "No new tool-health check", observedAt: null },
        { id: "dotnet", title: ".NET native assessment", status: "recorded_blocker", detail: "Recorded AppCAT installation failure: NuGet service-index / TLS access. Discovering a .NET app does not enable this integration.", observation: "Recorded failure; not rechecked", observedAt: null },
        { id: "planning", title: "Native technical planning", status: "recorded_blocker", detail: "Recorded standalone-extension compatibility failure: extensionSdkPath is required. No update or authentication change is attempted here.", observation: "Recorded failure; not rechecked", observedAt: null },
    ];
}

export function sourceRelationship(assessment, binding) {
    if (assessment.sourceStatus === "stale snapshot") return "Recorded snapshot; original source changed";
    if (assessment.source) return "Assessment snapshot recorded; not rechecked";
    if (binding) return "Current app linked; unverified against assessment";
    return "Unlinked import; source not verified";
}

export function coverageGaps(assessment, binding, canPrepareFull) {
    const action = (kind, label, enabled = true, reason = "") => ({ kind, label, enabled, reason });
    const cards = assessment.coverage.filter(item => item.state !== "reported").map(item => {
        const hasNarrative = assessment.insights.length > 0;
        const domainAbsent = item.state === "not_assessed";
        return {
            id: `coverage-${item.name}`,
            title: item.name,
            status: domainAbsent ? "Not assessed" : hasNarrative ? "Needs evidence review" : "Evidence unavailable",
            reason: domainAbsent ? "domain_not_declared" : hasNarrative ? "narrative_not_verified" : "facts_missing",
            detail: item.detail,
            impact: domainAbsent ? "No passing or failing result can be inferred for this domain." : "A trustworthy detailed view needs evidence for this area; a Full-mode label alone is insufficient.",
            evidence: domainAbsent ? "The native report does not declare this domain." : hasNarrative ? `${assessment.insights.length} narrative document(s) are available, but this specific analysis is not verified.` : "No native fact document was supplied.",
            actions: [
                action("import_folder", "Import report folder"),
                ...(!domainAbsent && assessment.nativeMode !== "full" ? [action("prepare_full", "Prepare Full-analysis request", canPrepareFull, "Choose an eligible Java review context first.")] : []),
                action("draft_question", "Draft a question"),
            ],
        };
    });
    if (!assessment.source || assessment.sourceStatus === "stale snapshot") {
        cards.unshift({
            id: "source",
            title: "Source relationship",
            status: binding ? "Current source linked" : assessment.source ? "Source changed" : "Source unlinked",
            reason: binding ? "current_unverified" : assessment.source ? "source_stale" : "source_unlinked",
            detail: sourceRelationship(assessment, binding),
            impact: "Current files cannot be presented as historical assessment evidence without a recorded snapshot hash.",
            evidence: binding ? `User-linked app: ${binding.relativePath}. This is not verification or permission to read files.` : "A verified current-source relationship is not available.",
            actions: [action("start", binding ? "Review source link" : "Link current source"), action("draft_question", "Draft a question")],
        });
    }
    return cards;
}
