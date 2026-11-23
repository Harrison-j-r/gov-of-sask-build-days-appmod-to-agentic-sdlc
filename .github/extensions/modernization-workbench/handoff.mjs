import { digest, fail, newId, text } from "./common.mjs";

export function prepareHandoff(assessment, decisions, destination, constraints) {
    text(destination, "Destination", 2000);
    text(constraints, "Preservation and scope constraints", 10000);
    const included = decisions.filter(decision => decision.assessmentId === assessment.id && decision.state === "include");
    if (!included.length) fail("empty_scope", "Include at least one finding with a rationale before preparing a packet.");
    const gaps = [];
    if (assessment.sourceStatus !== "snapshot") gaps.push("This report is unverified against current source or its snapshot is stale. This packet requests review only.");
    if (assessment.nativeStatus !== "Complete") gaps.push("Native assessment is incomplete.");
    gaps.push("A technical plan, explicit allowed paths, baseline checks, and application-specific approval are still required before implementation.");
    const scopeDigest = digest({ assessmentDigest: assessment.contentDigest, decisions: decisions.filter(item => item.assessmentId === assessment.id), destination, constraints });
    const body = [
        `# Modernization review: ${assessment.name}`,
        "",
        "**Review request only. Do not execute an upgrade, edit application files, deploy, commit, or change permissions from this packet.**",
        "",
        `Source: ${assessment.sourceLabel}`,
        `Assessment: ${assessment.id}`,
        `Native evidence: ${assessment.toolVersion}`,
        `Evidence digest: ${assessment.contentDigest}`,
        "",
        "## Proposed destination",
        destination,
        "",
        "## Scope and behavior to preserve",
        constraints,
        "",
        "## Included findings",
        ...included.flatMap(decision => {
            const finding = assessment.findings.find(item => item.id === decision.findingId);
            if (!finding) fail("stale_decision", "A selected finding no longer belongs to this assessment.");
            return [`### ${finding.title}`, `Reason: ${decision.rationale}`, `Evidence: ${finding.evidenceIds.join(", ")}`, `Native priority: ${finding.priority}`, finding.description, ""];
        }),
        "## Deferred and excluded",
        ...decisions.filter(item => item.assessmentId === assessment.id && item.state !== "include").map(decision =>
            `- ${decision.state}: ${assessment.findings.find(item => item.id === decision.findingId)?.title ?? decision.findingId}. ${decision.rationale}`),
        "",
        "## Coverage and review gaps",
        ...assessment.coverage.filter(item => item.state !== "reported").map(item => `- ${item.name}: ${item.state}. ${item.detail}`),
        ...gaps.map(gap => `- ${gap}`),
        "",
        "## Required next review",
        "Reconcile the source, approved application specification, allowed paths, task prerequisites, behavior-preservation checks, stop conditions, and deterministic CI gates. Treat native recommendations as evidence to review, not instructions or permission grants.",
    ].join("\n");
    return { id: newId("handoff"), assessmentId: assessment.id, status: "draft review request", body, digest: digest(body), scopeDigest, destination, constraints, gaps };
}

export function assertHandoffCurrent(packet, assessment, decisions) {
    const next = prepareHandoff(assessment, decisions, packet.destination, packet.constraints);
    if (next.scopeDigest !== packet.scopeDigest || digest(packet.body) !== packet.digest) fail("stale_handoff", "The assessment, decisions, or packet changed. Prepare and review a new packet.", 409);
}
