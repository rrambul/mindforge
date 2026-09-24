/**
 * The first user turn of a run.
 *
 * It names the skills because loading one does not make the agent use it. A
 * skill's body — the lesson shape, the prose budget, the humanizer's rules —
 * reaches the model only when it calls `Skill`, and the second lesson ever written
 * for the system-design mission never did: it read the first lesson, copied its
 * shape, and wrote from memory (2026-09-24). Naming the skill turns "may" into
 * "was told to", and `skill_not_invoked` reports it when a run still does not.
 */
export function openingPrompt(skills: readonly string[]): string {
  const [main, ...companions] = skills;
  const parts = [
    "Teach me the next thing. Read BRIEFING.md first — it has my current zone of " +
      "proximal development, weak skills, and what is not measured yet.",
  ];
  if (main !== undefined) {
    parts.push(
      `Invoke the \`${main}\` skill before writing anything: it says what to write and how.`,
    );
  }
  if (companions.length > 0) {
    const named = companions.map((skill) => `\`${skill}\``).join(" and ");
    parts.push(
      `Its last step names ${named} — invoke ${companions.length === 1 ? "it" : "them"} as that ` +
        "step says, before you finish.",
    );
  }
  return parts.join(" ");
}

/**
 * Whether `ref` was among the skills invoked. The agent usually passes the
 * namespaced name, but the `Skill` tool also resolves a bare one, so both count.
 */
export function wasInvoked(ref: string, invoked: ReadonlySet<string>): boolean {
  return invoked.has(ref) || invoked.has(ref.slice(ref.indexOf(":") + 1));
}
