import { lesson, type TrainingCourse } from '@/lib/training-course-model'

export const CONTENT_REVIEW: TrainingCourse = {
  level: 'Beginner friendly · no prior experience',
  summary:
    'Apply a written policy to user content, consistently and defensibly. Learn to separate offence from violation, write an audit note, and escalate the cases that should never be decided alone.',
  objectives: [
    'Read the whole item and its context before deciding.',
    'Distinguish a policy violation from content you personally dislike.',
    'Apply the most specific tag and write a short, defensible reason.',
    'Recognize imminent-risk and illegal-content cases that require escalation.',
  ],
  heroImage: '/training/review-overview.svg',
  heroAlt:
    'A queue of three comments flowing through a policy check into allow, remove, or escalate decisions.',
  heroCaption: 'Policy first, opinion second. The audit note is part of the decision.',
  modules: [
    lesson(
      'Policy, not personal taste',
      6,
      `
### What content review is

You are the consistent application of a written policy at scale. The policy tells you what the platform allows, what it removes, and what it sends to a specialist. Your job is to apply it the same way to a rude comment, a famous account, and a post from someone you agree with.

### The most common beginner mistake

Confusing “offensive” with “violating”. A lot of content is unpleasant without breaking a rule. A review that removes everything that feels bad is not safer; it is inconsistent, and it trains users to distrust the system.

### The second most common mistake

Deciding from the thumbnail. Context changes meaning: a quote, a news report, a joke between friends, a reclaimed term, a callout of someone else's abuse. Open the item. Read the surrounding post. Check the author's caption and, where the policy requires it, the linked context.

### The three outcomes

- **Allow.** No rule is broken. The content may still be rude, wrong, or unpopular.
- **Remove and tag.** A specific rule is broken. Apply the most specific tag the taxonomy offers.
- **Escalate.** The case is high-risk, ambiguous, or outside your authority. Do not guess.

**Your decision has to be explainable to a second reviewer who cannot see your reaction.**
`,
      {
        check: {
          question:
            'Content is rude and you personally dislike it, but no policy rule covers it. What is the right decision?',
          options: [
            'Remove it because it is offensive',
            'Allow it and continue',
            'Escalate every rude comment',
            'Ask the author to apologise',
          ],
          correctIndex: 1,
          explanation:
            'The policy is the standard, not personal taste. If no rule covers it, allow it and keep the queue consistent.',
        },
      },
    ),
    lesson(
      'The review workflow: context, policy, decision, note',
      8,
      `
### 1. Read the item and its context

Open the full post, not just the reported snippet. Read the caption, the parent post, and the visible replies. Check whether the content is a quote, a news report, satire, or a direct attack. The same words can be a violation in one context and protected speech in another.

### 2. Identify the rule

Find the policy line that applies before you decide the outcome. If two rules could apply, read both definitions and choose the most specific one. Do not invent a rule because the content feels dangerous.

### 3. Decide

- **Allow** when no rule applies.
- **Remove + tag** when a rule clearly applies. Use the most specific tag, not a broad catch-all.
- **Escalate** when the case involves imminent risk, a credible threat, apparent illegal content, a high-profile account, or a policy ambiguity you cannot resolve.

### 4. Write the audit note

A good note is short and factual: what the content said, which rule applied, and what you did. Do not include your opinion of the author. Do not paste unnecessary personal data. A second reviewer should be able to reconstruct your decision.

### 5. Keep the queue moving

Do not spend ten minutes on a clear spam post. Do not rush a credible threat. Triage by risk, and escalate early when the policy says to.

### 6. Protect yourself

Reviewing disturbing content is hard. Follow the project's breaks and rotation rules. If a piece of content is affecting your judgement, step away and come back with fresh eyes. That is part of doing the job well, not a weakness.
`,
      {
        check: {
          question: 'What should you do before choosing allow or remove?',
          options: [
            'Check the author’s follower count',
            'Read the full context and identify the specific policy rule',
            'Ask a colleague to vote',
            'Decide from the thumbnail',
          ],
          correctIndex: 1,
          explanation:
            'Context and the written rule are the two inputs. Popularity and personal reaction are not policy criteria.',
        },
      },
    ),
    lesson(
      'Writing a decision you can defend',
      8,
      `
### The note is the audit trail

A decision without a reason is hard to review and easy to overturn. The note does not need to be long. It needs to answer three questions:

1. What did the content do?
2. Which rule applies?
3. What action did you take?

**Example:** “Direct insult targeting a named user with a racial slur. Hate speech — targeted. Removed.”

**Weak example:** “Bad vibes. Removed.” It records a feeling, not a decision.

### Be specific, not graphic

Quote only the minimum needed to identify the violation. Do not reproduce slurs or graphic descriptions in the note if a category and a short paraphrase are enough. The note is for review, not for performance.

### Consistency across the queue

Ask yourself: would I make the same decision if this came from a different account, a different language, or a different community? If not, re-read the policy. Inconsistent enforcement is a policy problem, and your note is the evidence that helps the team find it.

### When the policy is silent

Do not improvise a new rule. Escalate with the exact question: “Policy section 4 covers harassment but does not say whether a general insult with no target is covered. This post says … Which outcome should apply?” That is a useful escalation. “Not sure” is not.

### Correcting a mistake

If you realise you removed the wrong item, say so through the approved correction channel. Do not edit the audit note to hide the error. A transparent correction is cheaper than a hidden inconsistency.
`,
      {
        image: '/training/review-decision.svg',
        imageAlt:
          'A decision tree asking whether there is a clear policy violation, branching to allow, escalate, or remove with a specific tag.',
        imageCaption:
          'If the answer is not clear from the policy, escalate instead of inventing a rule.',
        check: {
          question: 'Which audit note is the most defensible?',
          options: [
            '“Bad content. Removed.”',
            '“User is annoying. Removed.”',
            '“Direct threat of violence against a named person. Threats — credible. Removed and escalated.”',
            '“I did not like it.”',
          ],
          correctIndex: 2,
          explanation:
            'A defensible note names the conduct, the specific rule or tag, and the action. It does not record a personal reaction.',
        },
      },
    ),
    lesson(
      'High-risk cases: threats, self-harm, and illegal content',
      8,
      `
### Imminent risk

A credible threat of violence, a plan to harm a specific person, or a post suggesting immediate self-harm is not a normal queue item. Follow the project's emergency escalation path immediately. Do not reply to the user, do not share the content outside the approved tool, and do not wait until the end of your shift.

### Self-harm content

Distinguish support, news, and recovery content from content that encourages or instructs self-harm. The policy will define the line. When someone appears to be in immediate danger, escalate; do not rely on a generic tag.

### Apparent illegal content

If you encounter apparent child sexual abuse material, do not download, copy, describe in detail, or share it. Stop, preserve the minimum necessary record through the approved channel, and escalate immediately. This is a legal and safety boundary, not a judgement call.

### Harassment and doxxing

A public figure can still be harassed. Look for a targeted pattern, the sharing of private information, and a credible power imbalance. Do not treat a criticism of a public figure as harassment just because it is harsh; do not treat a coordinated campaign as a one-off comment.

### Other policy areas you will meet

- **Coordinated harassment.** One comment may look minor; a campaign across accounts is a pattern. Flag the accounts for higher-level review rather than judging each post alone.
- **Copyright.** Most review queues action copyright through a formal notice process, not proactive guessing. Follow the policy; do not delete a post just because it looks professional.
- **Health or civic misinformation.** Only the categories the policy names are removed. “The moon is cheese” is not the same as a harmful medical claim.
- **Educational or medical nudity.** Some policies allow a narrow exception. Apply the written definition and the context, not a blanket rule.
- **Content in a language you do not speak.** Use the approved translation/route-to-native-reviewer path. Do not guess the meaning or auto-approve it.

### When you are unsure

Escalate. The cost of a short review is small. The cost of a wrong decision on a high-risk case is not.
`,
      {
        check: {
          question: 'You encounter apparent child sexual abuse material. What should you do?',
          options: [
            'Download it as evidence for your note',
            'Share it with a colleague to confirm',
            'Stop, avoid copying or sharing it, and escalate immediately through the approved channel',
            'Tag it as spam and continue',
          ],
          correctIndex: 2,
          explanation:
            'Do not copy, download, or share illegal content. Stop and use the emergency escalation path immediately.',
        },
      },
    ),
    lesson(
      'Practice: three decisions',
      7,
      `
### Scenario 1

A user writes: “This product is garbage and the company should be ashamed.” No person is targeted. The policy prohibits harassment and threats, not criticism.

**Decision:** Allow. It is negative and rude, but it is an opinion about a product, not a targeted attack.

### Scenario 2

A user posts a photo of a named neighbour with their home address and writes: “Everyone should know where this person lives.”

**Decision:** Remove and tag as private information / doxxing. The address is private information and the post invites others to act on it. Escalate if the project treats doxxing as high-risk.

### Scenario 3

A user posts: “I am going to hurt them tomorrow. I know where they work.” The target is identifiable from the thread.

**Decision:** Escalate immediately as a credible threat. Do not wait for a second opinion before using the emergency channel.

### Self-check

- Did you read the full context before deciding?
- Did you name the specific rule or tag?
- Did you separate “offensive” from “violating”?
- Would a second reviewer reach the same decision from your note?
`,
      {
        check: {
          question:
            'A post shares a private individual’s home address and invites others to visit. Which outcome fits?',
          options: [
            'Allow, because the address is public record',
            'Remove and tag as private information / doxxing',
            'Remove and tag as spam',
            'Escalate only if the person complains',
          ],
          correctIndex: 1,
          explanation:
            'Sharing private information with an invitation to act is doxxing. The specific tag matters; “spam” hides the real risk.',
        },
      },
    ),
    lesson(
      'Submission checklist and the assessment',
      5,
      `
### Before you submit

- [ ] You read the full item and its context, not only the reported snippet.
- [ ] You identified a specific policy rule before deciding.
- [ ] You separated personal offence from a policy violation.
- [ ] You applied the most specific tag, not a catch-all.
- [ ] Your audit note names the conduct, the rule, and the action.
- [ ] High-risk cases went to escalation immediately.
- [ ] You did not copy or share illegal or distressing material.

### The assessment

The assessment gives you short scenarios and asks for the next action: allow, remove with a tag, or escalate. Two-thirds correct is a pass. The explanations are the policy reasoning you should be able to repeat on the queue.

### On the job

Consistency beats speed on the first batch. Read the policy once per shift, review your notes, and escalate early when the case is outside the clear lines. A calm, well-documented decision is the deliverable.
`,
    ),
  ],
}
