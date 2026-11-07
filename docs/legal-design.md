# Legal design

Background: the feasibility research (30 Oct 2026) found that software is not a tax agent service if it is non-customised and the user checks the data (TPB(I) 09/2011, Example 5), but tailored judgement the user relies on can be (TPB(GS) 44/2023). These constraints are built into the code:

1. **Rules in code, not in a model.** All treatment lives in `src/rules/rules.ts` and `src/engine`. Each rule has an id, a plain-English statement and a citation, and is shown to the user. No AI model makes a tax decision at run time.
2. **AI (when added) only extracts and asks.** Any model-based reader must output the fixed `Ledger` schema in `src/model.ts`, the same shape a deterministic parser produces. It must not output labels or amounts per label.
3. **The user confirms each figure.** The copy button for a figure unlocks only after the user ticks it, and a confirmation is tied to the exact value (if the value changes, it must be confirmed again). Classifications (share vs CFD) and parcel method are user choices.
4. **Never lodge, never log into myGov, never collect a TFN.**
5. **Escalate judgement calls** as "out of scope" issues instead of answering them: crypto, net CFD losses, FITO above $1,000, trader status.
6. **Wording.** Say "calculator" and "workpaper", never "tax advice" or "we do your tax".
7. **Privacy.** Statements are parsed in the browser and not sent anywhere.

Open items before charging money: a one-page opinion from a tax lawyer on the above, verifying every rule citation (`verified: false` today), and a registered tax agent partner for a paid review tier.
