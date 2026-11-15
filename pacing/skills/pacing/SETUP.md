# Setup

Read by the session on `/pacing setup`; SKILL.md points here.
`${CLAUDE_SKILL_DIR}` is the skill's folder.

1. `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" show`.
2. AskUserQuestion, with the current values first, marked "(current)":
   - the tiers (2 to 4), and each tier's model and effort;
   - optionally: the last-day weight, the next-session switch, the model
     of the plan's per-model meter (or none), the fallback tier that takes
     the top place while that meter is full, and the reader agent's model
     (or the lowest tier).

   Models: fable, opus, sonnet, haiku. Efforts: low, medium, high, xhigh,
   max.
3. Write the answers with `config.mjs` and the same words:
   `set <n> <model> <effort>`, `add <model> <effort>`, `remove <n>`,
   `weight <n>`, `next on|off`, `premium <model>|none`,
   `fallback <model> <effort>|none`, `reader <model> <effort>|ladder`.
   Show the result.
4. End with the manual step: the model menu must now show tier 1. Name it
   with its effort ("Fable 5.2, effort high").
