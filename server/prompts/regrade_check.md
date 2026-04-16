You are analyzing a GRADED Gradescope homework submission PDF for possible regrade requests.

The PDF is at: {pdf_path}

It contains the student's work PLUS Gradescope's grader annotations overlaid on each page:
rubric items, points awarded/deducted, grader comments, and the per-question score breakdown.

## Your job

1. Read the entire PDF using the Read tool. The file is {pdf_pages} pages. If it exceeds
   10 pages, read it in page ranges (1-10, 11-20, 21-...) so you cover every page. Do not skip pages.
2. For every question in the assignment, examine:
   - What the student wrote/submitted
   - Which rubric items the grader applied
   - Points awarded vs. available
   - Any grader comments
3. Look for regrade-worthy issues in these five categories:
   - arithmetic_mismatch — points deducted don't add up to the total shown
   - rubric_misapplication — the cited rubric item doesn't match what the student wrote
   - missed_correct_work — the student got something right but lost points (alternate valid
     method, correct answer marked wrong, etc.)
   - unclear_deduction — points taken with no explanation or a vague comment that prevents
     the student from understanding why
   - partial_credit_too_low — substantial correct work received disproportionately few points
4. Apply a strict "reasonable person" filter. Only flag issues a TA/professor would plausibly
   agree with upon re-review. Err strongly on the side of NOT flagging. False positives waste
   everyone's time. If you're unsure, don't flag it. Previously-denied regrade requests
   visible in the PDF should not be re-flagged.
5. Write the structured verdict to `{output_path}` using the Write tool, conforming to the JSON
   schema provided. Set item_id to "{item_id}".
6. If and only if the verdict contains at least one kept issue, also write `{draft_path}` with
   one section per kept issue in this format:

   # Regrade Requests — <assignment title> (<course if visible>)

   ## Question <N> — <short description>

   **Requesting regrade for:** <X points deducted under "rubric item">

   **Reason for request:**
   <1-2 paragraphs, respectful tone, citing specific page numbers and what the student wrote>

   ---

## Output requirements

- Your FINAL response must be the SAME JSON object you wrote to analysis.json.
- Do not skip pages. Do not guess at content. If a page is ambiguous, re-read it.
- Use your maximum reasoning effort. This is a high-stakes evaluation.
