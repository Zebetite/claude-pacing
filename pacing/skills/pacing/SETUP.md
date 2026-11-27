# Setup

Read by the session on `/pacing setup`; SKILL.md points here.
`${CLAUDE_SKILL_DIR}` is the skill's folder.

1. `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" show`.
2. AskUserQuestion, with the current values first, marked "(current)":
   - the tiers (2 to 6), and each tier's model and effort;
   - optionally: the last-day weight, the next-session switch, the model
     of the plan's per-model meter (or none), the fallback tier that takes
     the top place while that meter is used up, and the models of the reader
     agent and of the verifier's plain runs (or the lowest tier);
   - where Claude Code compacts a session by itself: 750k (the default),
     another token count from 100k to 1M, auto (Claude Code's own
     default) or off (pacing leaves `/autocompact` alone).

   Models: fable, opus, sonnet, haiku. Efforts: low, medium, high, xhigh,
   max.
3. Write all the answers in one call, the commands joined by ` + `:
   `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" apply set 1 fable high + add haiku low + weight 2`.
   The commands: `set <n> <model> <effort>`, `add <model> <effort>`,
   `remove <n>`, `weight <n>`, `next on|off`, `premium <model>|none`,
   `fallback <model> <effort>|none`, `reader <model> <effort>|ladder`,
   `verifier <model> <effort>|ladder`, `autocompact <tokens>|auto|off`. It stops at the first one that is
   refused and says which. Show the result.
4. End with the manual step: the model menu must now show tier 1. Name it
   with its effort ("Fable 5.2, effort high").
