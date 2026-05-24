/* ===== VSMS Wireframe — Shared JavaScript ===== */

// Sidebar toggle for mobile
function initSidebar() {
  const hamburger = document.querySelector(".hamburger");
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.querySelector(".sidebar-overlay");

  if (hamburger) {
    hamburger.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      overlay.classList.toggle("active");
    });
  }

  if (overlay) {
    overlay.addEventListener("click", () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("active");
    });
  }
}

// Table/Card view toggle
function initViewToggle() {
  const toggleBtns = document.querySelectorAll(".view-toggle button");
  toggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.view;
      const container = btn.closest(".page-content") || btn.closest(".card");

      toggleBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const pageContent = btn.closest(".page-content");
      const tableView = (pageContent || container).querySelector(".table-view");
      const cardView = (pageContent || container).querySelector(".card-view");

      if (target === "table") {
        if (tableView) tableView.style.display = "block";
        if (cardView) cardView.style.display = "none";
      } else {
        if (tableView) tableView.style.display = "none";
        if (cardView) cardView.style.display = "block";
      }
    });
  });
}

// Tabs
function initTabs() {
  const tabContainers = document.querySelectorAll("[data-tabs]");
  tabContainers.forEach((container) => {
    const tabs = container.querySelectorAll(".tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        const parent = container.closest(".card") || container.parentElement;

        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        parent
          .querySelectorAll(".tab-content")
          .forEach((tc) => tc.classList.remove("active"));
        const targetEl = parent.querySelector(`[data-tab-content="${target}"]`);
        if (targetEl) targetEl.classList.add("active");
      });
    });
  });
}

// Generate sidebar HTML
function getSidebarHTML(activePage) {
  const navItems = [
    {
      section: "Main",
      items: [
        {
          id: "dashboard",
          label: "Dashboard",
          href: "dashboard.html",
          icon: "⊞",
        },
      ],
    },
    {
      section: "Vehicles",
      items: [
        {
          id: "vehicles",
          label: "Inventory",
          href: "vehicles.html",
          icon: "🚗",
        },
        {
          id: "vehicle-add",
          label: "Add Vehicle",
          href: "vehicle-add.html",
          icon: "+",
        },
      ],
    },
    {
      section: "Sales",
      items: [
        { id: "sales", label: "All Sales", href: "sales.html", icon: "💰" },
        {
          id: "advances",
          label: "Advances",
          href: "advances.html",
          icon: "⏳",
          badge: "3",
        },
      ],
    },
    {
      section: "Repairs",
      items: [
        {
          id: "send-repair",
          label: "Send for Repair",
          href: "send-repair.html",
          icon: "🔧",
        },
        {
          id: "return-repair",
          label: "Return from Repair",
          href: "return-repair.html",
          icon: "✓",
        },
        {
          id: "repair-vendors",
          label: "Repair Vendors",
          href: "repair-vendors.html",
          icon: "🏪",
        },
      ],
    },
    {
      section: "Directory",
      items: [
        {
          id: "customers",
          label: "Customers",
          href: "customers.html",
          icon: "👥",
        },
        {
          id: "suppliers",
          label: "Suppliers",
          href: "suppliers.html",
          icon: "🏢",
        },
      ],
    },
    {
      section: "Approvals",
      items: [
        {
          id: "approvals",
          label: "Pending Approvals",
          href: "approvals.html",
          icon: "✋",
          badge: "2",
        },
      ],
    },
    {
      section: "Reports",
      items: [
        {
          id: "reports",
          label: "All Reports",
          href: "reports.html",
          icon: "📊",
        },
        {
          id: "report-inventory",
          label: "Inventory Report",
          href: "report-inventory.html",
          icon: "📊",
        },
        {
          id: "report-sales",
          label: "Sales Report",
          href: "report-sales.html",
          icon: "📊",
        },
        {
          id: "report-profit",
          label: "Profit Report",
          href: "report-profit.html",
          icon: "📊",
        },
        {
          id: "report-advances",
          label: "Advances Report",
          href: "report-advances.html",
          icon: "📊",
        },
        {
          id: "report-repairs",
          label: "Repairs Report",
          href: "report-repairs.html",
          icon: "📊",
        },
        {
          id: "report-cashflow",
          label: "Cash Flow Report",
          href: "report-cashflow.html",
          icon: "📊",
        },
        {
          id: "report-customer",
          label: "Customer Report",
          href: "report-customer.html",
          icon: "📊",
        },
      ],
    },
    {
      section: "Admin",
      items: [
        { id: "users", label: "Users", href: "users.html", icon: "👤" },
        {
          id: "roles",
          label: "Roles & Permissions",
          href: "roles.html",
          icon: "🔑",
        },
        {
          id: "audit-trail",
          label: "Audit Trail",
          href: "audit-trail.html",
          icon: "📝",
        },
        {
          id: "data-import",
          label: "Data Import",
          href: "data-import.html",
          icon: "📥",
        },
        {
          id: "writeoff",
          label: "Write Off",
          href: "writeoff.html",
          icon: "🗑️",
        },
      ],
    },
  ];

  let html = `
    <div class="sidebar-logo">
      <img src="va_motors_logo.jpeg" alt="VA Motors">
      <h2>VA Motors</h2>
    </div>
    <nav class="sidebar-nav">`;

  navItems.forEach((section) => {
    html += `<div class="nav-section">
      <div class="nav-section-title">${section.section}</div>`;
    section.items.forEach((item) => {
      const isActive = item.id === activePage ? " active" : "";
      const badge = item.badge
        ? `<span class="nav-badge">${item.badge}</span>`
        : "";
      html += `<a class="nav-item${isActive}" href="${item.href}">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
        ${badge}
      </a>`;
    });
    html += `</div>`;
  });

  html += `</nav>
    <div class="sidebar-footer">
      <div class="user-info">
        <div class="user-avatar">SA</div>
        <div>
          <div class="user-name">Sandun Admin</div>
          <div class="user-role">Administrator</div>
        </div>
      </div>
    </div>`;

  return html;
}

// Generate top header HTML
function getHeaderHTML(title) {
  return `
    <button class="hamburger" aria-label="Toggle sidebar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>
    <div class="header-title">${title}</div>
    <div class="header-actions">
      <a href="approvals.html" class="notification-bell" title="Pending Approvals">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M9 12l2 2 4-4"/>
          <rect x="3" y="3" width="18" height="18" rx="3"/>
        </svg>
        <span class="badge">2</span>
      </a>
      <a href="dashboard.html#notifications" class="notification-bell" title="Notifications">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span class="badge">5</span>
      </a>
    </div>`;
}

// Inject layout into page
function initLayout(activePage, pageTitle) {
  const sidebar = document.querySelector(".sidebar");
  const header = document.querySelector(".top-header");

  if (sidebar) sidebar.innerHTML = getSidebarHTML(activePage);
  if (header) header.innerHTML = getHeaderHTML(pageTitle);
}

// Initialize everything on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  const title = document.body.dataset.title || "VSMS";

  initLayout(page, title);
  initSidebar();
  initViewToggle();
  initTabs();
});
