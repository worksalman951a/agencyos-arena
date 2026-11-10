/**
 * AgencyOS Automation entry point.
 *
 * This route used to be a "Coming Soon / Roadmap: Future Phase" placeholder even
 * after workflow rules shipped, so anyone landing on `/automation/workflows`
 * (the obvious URL, and the one the module is named after) was told the feature
 * did not exist. The real module lives at `/automation/rules`, so this is now a
 * plain redirect instead of a dead end.
 */

import { redirect } from 'next/navigation';

// Evaluate the redirect per request rather than baking it into the build, so the
// route behaves like the rest of the authenticated module.
export const dynamic = 'force-dynamic';

export default function WorkflowsPage() {
  redirect('/automation/rules');
}
