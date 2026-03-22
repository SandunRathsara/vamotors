---
phase: quick
plan: 260322-tpo
type: execute
wave: 1
depends_on: []
files_modified:
  - design/dashboard.html
  - design/vehicles.html
  - design/vehicle-detail.html
  - design/reports.html
  - design/lease-dispatch.html
  - design/lease-comparison.html
  - design/lease-reconciliation.html
  - design/approvals.html
  - design/third-parties.html
  - design/users.html
  - design/purchases.html
  - design/sale-detail.html
autonomous: false
must_haves:
  truths:
    - "All 12 updated design files use the Stitch tonal layering design system (Inter font, surface tiers, no-line philosophy)"
    - "Sidebar navigation in all 12 files contains working links to ALL design pages (including non-Stitch pages like login, settings, etc.)"
    - "Sidebar navigation is consistent across all 12 updated files — same links, same structure, same icons"
    - "Non-Stitch design files (login.html, settings.html, etc.) are untouched"
    - "All 12 files open correctly in a browser and render their main content area matching the Stitch designs"
  artifacts:
    - path: "design/dashboard.html"
      provides: "Stitch-styled dashboard with working nav"
    - path: "design/vehicles.html"
      provides: "Stitch-styled vehicle inventory list"
    - path: "design/vehicle-detail.html"
      provides: "Stitch-styled vehicle detail view"
    - path: "design/reports.html"
      provides: "Stitch-styled reports hub"
    - path: "design/lease-dispatch.html"
      provides: "Stitch-styled lease dispatch"
    - path: "design/lease-comparison.html"
      provides: "Stitch-styled lease comparison tool"
    - path: "design/lease-reconciliation.html"
      provides: "Stitch-styled commission reconciliation"
    - path: "design/approvals.html"
      provides: "Stitch-styled manager approval queue"
    - path: "design/third-parties.html"
      provides: "Stitch-styled third parties list"
    - path: "design/users.html"
      provides: "Stitch-styled users management"
    - path: "design/purchases.html"
      provides: "Stitch-styled purchase form wizard"
    - path: "design/sale-detail.html"
      provides: "Stitch-styled advance sale flow"
  key_links:
    - from: "All 12 design files"
      to: "All design/*.html pages"
      via: "Sidebar nav href attributes"
      pattern: 'href="[a-z-]+\\.html"'
---

<objective>
Replace 12 existing HTML design files with their Stitch design counterparts, updating the sidebar navigation in each to maintain full inter-page connectivity across all design pages.

Purpose: Adopt the more sophisticated Stitch "Tonal Layering Strategy" design system (Inter font, surface-container tiers, no-line philosophy, glass headers) across the core screens while preserving the navigation structure that ties all design pages together.

Output: 12 updated HTML files in design/ using the Stitch design system with consistent, working sidebar navigation.
</objective>

<execution_context>
@/Users/alpha/Developer/personal/va/.claude/get-shit-done/workflows/execute-plan.md
@/Users/alpha/Developer/personal/va/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@design/dashboard.html (existing — for sidebar nav structure reference)
@design/styles.css (existing design system — NOT used by Stitch files)

Stitch source files in /tmp/stitch-designs/:
@/tmp/stitch-designs/dashboard.html
@/tmp/stitch-designs/vehicles.html
@/tmp/stitch-designs/vehicle-detail.html
@/tmp/stitch-designs/reports.html
@/tmp/stitch-designs/lease-dispatch.html
@/tmp/stitch-designs/lease-comparison.html
@/tmp/stitch-designs/commission-reconciliation.html
@/tmp/stitch-designs/manager-approval-queue.html
@/tmp/stitch-designs/third-parties.html
@/tmp/stitch-designs/users.html
@/tmp/stitch-designs/purchase-form-wizard.html
@/tmp/stitch-designs/advance-sale-flow.html

<interfaces>
**Screen-to-file mapping (Stitch source -> target):**
1. /tmp/stitch-designs/dashboard.html -> design/dashboard.html
2. /tmp/stitch-designs/vehicles.html -> design/vehicles.html
3. /tmp/stitch-designs/vehicle-detail.html -> design/vehicle-detail.html
4. /tmp/stitch-designs/reports.html -> design/reports.html
5. /tmp/stitch-designs/lease-dispatch.html -> design/lease-dispatch.html
6. /tmp/stitch-designs/lease-comparison.html -> design/lease-comparison.html
7. /tmp/stitch-designs/commission-reconciliation.html -> design/lease-reconciliation.html
8. /tmp/stitch-designs/manager-approval-queue.html -> design/approvals.html
9. /tmp/stitch-designs/third-parties.html -> design/third-parties.html
10. /tmp/stitch-designs/users.html -> design/users.html
11. /tmp/stitch-designs/purchase-form-wizard.html -> design/purchases.html
12. /tmp/stitch-designs/advance-sale-flow.html -> design/sale-detail.html

**Existing sidebar nav structure (from design/dashboard.html lines 75-106):**
The current sidebar has these sections and links:
- Main: Dashboard, Vehicles, Purchases, Sales, Repairs
- Management: Customers, Third Parties, Reports, Approvals (with badge)
- Finance: Reconciliation, Cash Flow
- Brokerage: Lease Deals, Comparison Tool, Rate Sheets, Dispatch
- System: Settings, Users & Roles

**Stitch sidebar structure (from Stitch files):**
The Stitch sidebar uses Material Symbols icons and generic `href="#"` links. It has a simplified nav:
Dashboard, Inventory, Sales, Customers, Third Parties, Finance, Reports, Lease Brokerage, Admin, Utilities.

**Key differences to reconcile:**
- Stitch uses `href="#"` everywhere — must be replaced with actual page hrefs
- Stitch sidebar is more condensed (fewer explicit links) — adopt existing page-level granularity
- Stitch uses Material Symbols font icons — keep these (they look better)
- Stitch uses Tailwind CDN — keep this (self-contained files)
- Existing sidebar has more granular links (e.g., separate Lease Deals, Comparison, Rate Sheets, Dispatch) — preserve all links

**Pages WITHOUT Stitch counterparts (must remain linkable from sidebar but do NOT modify these files):**
login.html, cash-flow.html, customer-detail.html, customers.html, lease-deal-detail.html,
lease-deals.html, repairs.html, report-advances.html, report-audit.html, report-profit.html,
report-purchases.html, report-repairs.html, report-sales.html, report-stock.html, sales.html,
settings.html, lease-rate-sheets.html, third-party-detail-supplier.html,
third-party-detail-garage.html, third-party-detail-finance.html
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Build sidebar nav template and copy all 12 Stitch files with updated navigation</name>
  <files>
    design/dashboard.html, design/vehicles.html, design/vehicle-detail.html,
    design/reports.html, design/lease-dispatch.html, design/lease-comparison.html,
    design/lease-reconciliation.html, design/approvals.html, design/third-parties.html,
    design/users.html, design/purchases.html, design/sale-detail.html
  </files>
  <action>
    For each of the 12 Stitch files, copy it to the corresponding design/ target, then replace the sidebar nav section with a unified sidebar that:

    1. **Read the existing design/dashboard.html sidebar** (lines 75-106) to get the complete list of nav links and their page hrefs.

    2. **Define the canonical sidebar** using the Stitch visual style (Tailwind classes, Material Symbols icons, tonal layering) but with the FULL set of page links from the existing sidebar. The sidebar must include ALL of these links grouped as:

       **Main:**
       - Dashboard (dashboard.html) — icon: dashboard
       - Vehicles (vehicles.html) — icon: directions_car
       - Purchases (purchases.html) — icon: shopping_cart
       - Sales (sales.html) — icon: point_of_sale
       - Repairs (repairs.html) — icon: build

       **Management:**
       - Customers (customers.html) — icon: group
       - Third Parties (third-parties.html) — icon: handshake
       - Reports (reports.html) — icon: analytics
       - Approvals (approvals.html) — icon: task_alt (keep the badge showing "3")

       **Finance:**
       - Reconciliation (lease-reconciliation.html) — icon: account_balance
       - Cash Flow (cash-flow.html) — icon: monitoring

       **Brokerage:**
       - Lease Deals (lease-deals.html) — icon: description
       - Comparison Tool (lease-comparison.html) — icon: compare
       - Rate Sheets (lease-rate-sheets.html) — icon: grid_on
       - Dispatch (lease-dispatch.html) — icon: local_shipping

       **System:**
       - Settings (settings.html) — icon: settings
       - Users & Roles (users.html) — icon: manage_accounts

    3. **For each file, set the correct active state** on the sidebar link matching that page. Use the Stitch active style: `bg-white text-blue-700 font-semibold shadow-sm rounded-md translate-x-1`. All other links use the inactive style.

    4. **Keep the Stitch top header bar** (glass effect with backdrop-blur) but update the breadcrumb/tab links in the header to use real hrefs where applicable (e.g., "Dashboard" links to dashboard.html, "Inventory" links to vehicles.html, "Sales" links to sales.html).

    5. **Keep the entire main content area** from each Stitch file untouched — this is the design we want to adopt.

    6. **Update the HTML title** to match the existing convention: "{Page Name} - VA Motors VSMS" (e.g., "Dashboard - VA Motors VSMS").

    Process each file in this order:
    - First build the sidebar nav HTML snippet as a template string (reusable across all 12 files)
    - For each mapping: read Stitch source, find the aside element, replace it with the canonical sidebar (setting the correct active link), find the header nav links and update hrefs, update the title tag, write to design/ target
  </action>
  <verify>
    <automated>
      # Verify all 12 files exist and contain working nav links
      cd /Users/alpha/Developer/personal/va && \
      for f in dashboard vehicles vehicle-detail reports lease-dispatch lease-comparison lease-reconciliation approvals third-parties users purchases sale-detail; do \
        [ -f "design/$f.html" ] && echo "EXISTS: $f.html" || echo "MISSING: $f.html"; \
      done && \
      echo "--- Nav link check ---" && \
      grep -c 'href="dashboard.html"' design/vehicles.html && \
      grep -c 'href="vehicles.html"' design/dashboard.html && \
      grep -c 'href="settings.html"' design/dashboard.html && \
      grep -c 'href="cash-flow.html"' design/dashboard.html && \
      echo "--- Active state check ---" && \
      grep -c 'translate-x-1.*dashboard.html\|dashboard.html.*translate-x-1' design/dashboard.html && \
      grep -c 'translate-x-1.*vehicles.html\|vehicles.html.*translate-x-1' design/vehicles.html && \
      echo "--- Stitch design system check ---" && \
      grep -c 'tailwindcss' design/dashboard.html && \
      grep -c 'Material+Symbols' design/dashboard.html && \
      grep -c 'Inter' design/dashboard.html
    </automated>
  </verify>
  <done>
    All 12 design files replaced with Stitch designs. Each file has: (a) the full sidebar nav with working links to all pages, (b) correct active state for its own page, (c) Stitch tonal layering design system for the main content area, (d) updated page title. Non-Stitch design files are untouched.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>All 12 design files updated from Stitch designs with unified sidebar navigation</what-built>
  <how-to-verify>
    1. Open design/dashboard.html in browser — verify Stitch design renders (tonal layering, Inter font, glass header, Material Symbols icons)
    2. Click through sidebar links — verify navigation works to all pages (vehicles, purchases, sales, repairs, customers, third-parties, reports, approvals, reconciliation, cash-flow, lease-deals, comparison, rate-sheets, dispatch, settings, users)
    3. Spot-check 3-4 other updated pages (vehicles.html, approvals.html, purchases.html, users.html) — verify each shows correct active state in sidebar and renders its Stitch main content
    4. Open a NON-updated page (e.g., settings.html, sales.html) — verify it still works and its old sidebar links still point to the correct pages
    5. Verify the overall visual quality: no-line philosophy, surface tiers, financial chips with color fill, editorial typography
  </how-to-verify>
  <resume-signal>Type "approved" or describe any issues</resume-signal>
</task>

</tasks>

<verification>
- All 12 target files exist in design/ and use the Stitch design system (Tailwind CDN, Inter font, Material Symbols)
- Every sidebar contains all 17 nav links with correct hrefs
- Each file's own page has the active state in the sidebar
- Non-Stitch files in design/ are not modified
- All files render correctly in browser
</verification>

<success_criteria>
- 12 design files updated with Stitch tonal layering design system
- Sidebar navigation consistent and fully functional across all 12 files
- Zero broken navigation links
- Non-Stitch design files untouched
- User confirms visual quality matches Stitch design intent
</success_criteria>

<output>
After completion, create `.planning/quick/260322-tpo-review-and-update-ui-designs-from-stitch/260322-tpo-SUMMARY.md`
</output>
