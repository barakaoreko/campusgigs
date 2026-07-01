/* =========================================================
   CAMPUSGIGS — APPLICATION LOGIC
   Handles: rendering worker cards, search, category filters,
   sorting, posting a request, listing a new worker, and the
   two modals (list-a-skill / worker-detail).
   Data comes straight from Supabase (workers & requests
   tables) — see supabase-config.js for the client setup.
   ========================================================= */

(function () {
  "use strict";

  const supabase = window.supabaseClient;

  /* ---------- State ---------- */
  let workers = [];
  let requests = [];
  let activeCategory = "all";
  let activeSearchTerm = "";
  let activeSort = "rating";
  let editingWorkerId = null;
  let editingRequestId = null;

  /* ---------- Cached DOM references ---------- */
  const grid = document.getElementById("worker-grid");
  const resultsCount = document.getElementById("results-count");
  const noResultsMsg = document.getElementById("no-results");
  const heroStats = document.getElementById("hero-stats");

  const heroSearchForm = document.getElementById("hero-search-form");
  const heroSearchInput = document.getElementById("hero-search-input");
  const heroCategorySelect = document.getElementById("hero-category-select");

  const filterChips = document.querySelectorAll(".filter-chip");
  const sortSelect = document.getElementById("sort-select");
  const clearFiltersBtn = document.getElementById("clear-filters-btn");

  const listingModal = document.getElementById("listing-modal");
  const openListingFormBtn = document.getElementById("open-listing-form");
  const closeListingFormBtn = document.getElementById("close-listing-form");
  const listingForm = document.getElementById("listing-form");
  const listingConfirmation = document.getElementById("listing-confirmation");

  const detailModal = document.getElementById("detail-modal");
  const closeDetailModalBtn = document.getElementById("close-detail-modal");
  const detailContent = document.getElementById("detail-content");

  const requestForm = document.getElementById("request-form");
  const requestConfirmation = document.getElementById("request-confirmation");
  const requestGrid = document.getElementById("request-grid");
  const noRequestsMsg = document.getElementById("no-requests");

  const categoryLabels = {
    tutoring: "Tutoring",
    programming: "Programming",
    design: "Design",
    freelance: "Freelance"
  };

  /* ---------- Show/hide nav items that require login ---------- */

  function reflectAuthInNav() {
    const loggedIn = !!window.CampusGigsAuth?.getCurrentUser();
    document.querySelectorAll(".auth-only-nav").forEach((el) => {
      el.hidden = !loggedIn;
    });

    const user = window.CampusGigsAuth?.getCurrentUser();

    // Sync the desktop header login/logout button label.
    const sidebarLoginLabel = document.getElementById("sidebar-login-label");
    if (sidebarLoginLabel) {
      sidebarLoginLabel.textContent = user
        ? `Log out (${user.name.split(" ")[0]})`
        : "Log in";
    }

    // Update the bottom user card in the dark sidebar.
    const avatarEl  = document.getElementById("sidebar-user-avatar");
    const nameEl    = document.getElementById("sidebar-user-name");
    const statusEl  = document.getElementById("sidebar-user-status");
    const wsLabel   = document.getElementById("sidebar-workspace-label");

    if (avatarEl && nameEl && statusEl) {
      if (user) {
        const initials = user.name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")
          .toUpperCase();
        avatarEl.textContent = initials;
        nameEl.textContent   = user.name;
        statusEl.textContent = `online · ${user.email}`;
        if (wsLabel) wsLabel.textContent = "Campus workspace";
      } else {
        avatarEl.textContent = "?";
        nameEl.textContent   = "Guest";
        statusEl.textContent = "Not signed in";
        if (wsLabel) wsLabel.textContent = "Workspace";
      }
    }
  }
  document.addEventListener("campusgigs:auth-changed", () => {
    reflectAuthInNav();
    // Re-render so owner-only edit/delete buttons appear or disappear
    // immediately after logging in or out, without needing a refresh.
    if (workers.length) renderGrid();
    if (requests.length) renderRequestGrid();
  });

  /* ---------- Helpers ---------- */

  function getInitials(name) {
    return name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDistance(miles) {
    return miles < 1 ? `${Math.round(miles * 10) / 10} mi` : `${miles} mi`;
  }

  function formatTsh(amount) {
    return `Tsh ${Math.round(amount).toLocaleString("en-US")}`;
  }

  /** Supabase's workers rows use full_name/hourly_rate (to dodge SQL
   *  keyword ambiguity). Translate to the name/rate shape the rest of
   *  this file already expects, right at the data boundary. */
  function fromSupabaseRow(row) {
    return {
      id: row.id,
      name: row.full_name,
      category: row.category,
      skill: row.skill,
      bio: row.bio,
      rate: row.hourly_rate,
      distance: row.distance,
      rating: row.rating,
      reviews: row.reviews,
      responseTime: row.response_time,
      ownerUserId: row.owner_user_id,
      contactCount: row.contact_count
    };
  }

  /** Same idea as fromSupabaseRow above, but for the requests table. */
  function requestFromSupabaseRow(row) {
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      budget: row.hourly_budget,
      details: row.details,
      ownerUserId: row.owner_user_id,
      createdAt: row.created_at
    };
  }

  /* ---------- Loading requests from Supabase ---------- */

  async function loadRequests() {
    const { data, error } = await supabase
      .from("requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Couldn't load requests:", error.message);
      requests = [];
    } else {
      requests = data.map(requestFromSupabaseRow);
    }
    renderRequestGrid();
  }

  function renderRequestGrid() {
    const currentUser = window.CampusGigsAuth?.getCurrentUser();

    requestGrid.innerHTML = "";
    requests.forEach((req) => {
      const isOwner = currentUser && currentUser.id === req.ownerUserId;
      const card = document.createElement("article");
      card.className = "worker-card request-card";
      card.innerHTML = `
        <span class="card-stamp cat-${req.category}">${categoryLabels[req.category]}</span>
        <p class="card-skill" style="padding-right:70px;">${escapeHtml(req.title)}</p>
        <p class="card-bio">${escapeHtml(req.details)}</p>
        <div class="card-footer">
          <span class="card-rate">${formatTsh(req.budget)}/hr budget</span>
          <span>${new Date(req.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        </div>
        ${
          isOwner
            ? `<div class="card-owner-actions">
                 <button type="button" class="link-btn" data-edit-request="${req.id}">Edit</button>
                 <button type="button" class="link-btn link-btn-danger" data-delete-request="${req.id}">Delete</button>
               </div>`
            : ""
        }
      `;
      requestGrid.appendChild(card);
    });

    noRequestsMsg.hidden = requests.length !== 0;
    requestGrid.hidden = requests.length === 0;

    // Wire up owner-only edit/delete buttons (only present for the owner's own cards).
    requestGrid.querySelectorAll("[data-delete-request]").forEach((btn) => {
      btn.addEventListener("click", () => deleteRequest(Number(btn.dataset.deleteRequest)));
    });
    requestGrid.querySelectorAll("[data-edit-request]").forEach((btn) => {
      btn.addEventListener("click", () => openEditRequestForm(Number(btn.dataset.editRequest)));
    });
  }

  async function deleteRequest(id) {
    if (!confirm("Delete this request? This can't be undone.")) return;
    const { error } = await supabase.from("requests").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    await loadRequests();
  }

  function openEditRequestForm(id) {
    const req = requests.find((r) => r.id === id);
    if (!req) return;

    // Reuses the existing "post a request" form for editing: fill it
    // with the current values and remember we're editing, not creating.
    document.getElementById("req-title").value = req.title;
    document.getElementById("req-category").value = req.category;
    document.getElementById("req-budget").value = req.budget;
    document.getElementById("req-details").value = req.details;
    editingRequestId = id;
    requestForm.querySelector("button[type=submit]").textContent = "Save changes";
    document.getElementById("post-request").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadWorkers() {
    const { data, error } = await supabase
      .from("workers")
      .select("*")
      .order("rating", { ascending: false });

    if (error) {
      console.error("Couldn't load listings:", error.message);
      workers = [];
    } else {
      workers = data.map(fromSupabaseRow);
    }
    renderGrid();
    renderHeroStats();
  }

  /* ---------- Rendering: worker cards (client-side filter/sort) ---------- */

  function getFilteredSortedWorkers() {
    let list = workers.filter((w) => {
      const matchesCategory = activeCategory === "all" || w.category === activeCategory;
      const haystack = `${w.name} ${w.skill} ${w.bio}`.toLowerCase();
      const matchesSearch = activeSearchTerm === "" || haystack.includes(activeSearchTerm);
      return matchesCategory && matchesSearch;
    });

    list = list.slice().sort((a, b) => {
      switch (activeSort) {
        case "price-asc":
          return a.rate - b.rate;
        case "price-desc":
          return b.rate - a.rate;
        case "distance":
          return a.distance - b.distance;
        case "rating":
        default:
          return b.rating - a.rating;
      }
    });

    return list;
  }

  function renderWorkerCard(worker) {
    const card = document.createElement("article");
    card.className = "worker-card";
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `View details for ${worker.name}, ${worker.skill}`);
    card.dataset.id = worker.id;

    card.innerHTML = `
      <span class="card-stamp cat-${worker.category}">${categoryLabels[worker.category]}</span>
      <div class="card-top">
        <div class="card-avatar">${getInitials(worker.name)}</div>
        <div>
          <p class="card-name">${escapeHtml(worker.name)}</p>
          <p class="card-rating"><span class="star">&#9733;</span> ${worker.rating.toFixed(1)} &middot; ${worker.reviews} reviews</p>
        </div>
      </div>
      <p class="card-skill">${escapeHtml(worker.skill)}</p>
      <p class="card-bio">${escapeHtml(worker.bio)}</p>
      <div class="card-footer">
        <span class="card-rate">${formatTsh(worker.rate)}/hr</span>
        <span>${formatDistance(worker.distance)} away</span>
      </div>
    `;

    card.addEventListener("click", () => openDetailModal(worker));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetailModal(worker);
      }
    });

    return card;
  }

  function renderGrid() {
    const list = getFilteredSortedWorkers();

    grid.innerHTML = "";
    list.forEach((worker) => grid.appendChild(renderWorkerCard(worker)));

    const total = workers.length;
    if (list.length === total) {
      resultsCount.textContent = `Showing all ${total} listings`;
    } else {
      resultsCount.textContent = `Showing ${list.length} of ${total} listings`;
    }

    noResultsMsg.hidden = list.length !== 0;
    grid.hidden = list.length === 0;
  }

  /* ---------- Hero stats (computed from the already-loaded workers) ---------- */

  function renderHeroStats() {
    if (workers.length === 0) {
      heroStats.innerHTML = "";
      return;
    }
    const avgRate = workers.reduce((sum, w) => sum + w.rate, 0) / workers.length;
    const categories = new Set(workers.map((w) => w.category)).size;

    heroStats.innerHTML = `
      <div><strong>${workers.length}</strong>listed nearby</div>
      <div><strong>${categories}</strong>skill categories</div>
      <div><strong>${formatTsh(avgRate)}</strong>avg. rate / hr</div>
    `;
  }

  /* ---------- Filters: search, category chips, sort ---------- */

  function setActiveCategory(category) {
    activeCategory = category;
    filterChips.forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.filter === category);
    });
    heroCategorySelect.value = category;
    renderGrid();
  }

  filterChips.forEach((chip) => {
    chip.addEventListener("click", () => setActiveCategory(chip.dataset.filter));
  });

  heroSearchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    activeSearchTerm = heroSearchInput.value.trim().toLowerCase();
    setActiveCategory(heroCategorySelect.value);
    document.getElementById("browse").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  sortSelect.addEventListener("change", () => {
    activeSort = sortSelect.value;
    renderGrid();
  });

  clearFiltersBtn.addEventListener("click", () => {
    activeSearchTerm = "";
    heroSearchInput.value = "";
    setActiveCategory("all");
  });

  /* ---------- Worker detail modal ---------- */

  function openDetailModal(worker) {
    const currentUser = window.CampusGigsAuth?.getCurrentUser();
    const isOwner = currentUser && currentUser.id === worker.ownerUserId;

    detailContent.innerHTML = `
      <div class="detail-head">
        <div class="detail-avatar">${getInitials(worker.name)}</div>
        <div>
          <h2 id="detail-name">${escapeHtml(worker.name)}</h2>
          <p>${escapeHtml(worker.skill)}</p>
          ${worker.ownerUserId ? `<button type="button" class="link-btn" id="view-profile-btn" style="margin-top:4px;">View full profile</button>` : ""}
        </div>
      </div>
      <div class="detail-meta">
        <div><strong>${formatTsh(worker.rate)}/hr</strong>Rate</div>
        <div><strong>${worker.rating.toFixed(1)} &#9733;</strong>${worker.reviews} reviews</div>
        <div><strong>${formatDistance(worker.distance)}</strong>From campus</div>
      </div>
      <p class="detail-bio">${escapeHtml(worker.bio)}</p>
      <p style="font-size:0.85rem; color: var(--ink-soft); margin: 0 0 18px;">Typical response time: ${worker.responseTime}</p>
      ${
        isOwner
          ? `<div class="card-owner-actions" style="margin-bottom:14px;">
               <button type="button" class="link-btn" id="edit-worker-btn">Edit this listing</button>
               <button type="button" class="link-btn link-btn-danger" id="delete-worker-btn">Delete</button>
             </div>`
          : `<button class="btn btn-primary btn-block" id="send-request-btn">Message ${escapeHtml(worker.name.split(" ")[0])}</button>`
      }
      <p class="form-note" id="detail-confirmation" role="status" aria-live="polite"></p>
    `;

    if (worker.ownerUserId) {
      document.getElementById("view-profile-btn").addEventListener("click", () => {
        closeDetailModal();
        if (window.CampusGigsProfile) {
          window.CampusGigsProfile.showPublicProfile(worker.ownerUserId);
        }
      });
    }

    if (isOwner) {
      document.getElementById("edit-worker-btn").addEventListener("click", () => {
        closeDetailModal();
        openEditWorkerForm(worker.id);
      });
      document.getElementById("delete-worker-btn").addEventListener("click", () => deleteWorker(worker.id));
    } else {
      document.getElementById("send-request-btn").addEventListener("click", async () => {
        const confirmationEl = document.getElementById("detail-confirmation");

        if (!worker.ownerUserId) {
          confirmationEl.textContent = "This is a sample listing without a real account behind it yet.";
          return;
        }
        if (!window.CampusGigsAuth.requireLogin()) return;

        // Bump contact_count for the "popular listing" signal, then hand
        // off straight into a real chat with this worker's owner.
        await supabase
          .from("workers")
          .update({ contact_count: (worker.contactCount || 0) + 1 })
          .eq("id", worker.id);

        closeDetailModal();
        if (window.CampusGigsMessages) {
          window.CampusGigsMessages.openConversationWith(worker.ownerUserId, worker.name);
        }
      });
    }

    detailModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeDetailModal() {
    detailModal.hidden = true;
    document.body.style.overflow = "";
  }

  closeDetailModalBtn.addEventListener("click", closeDetailModal);
  detailModal.addEventListener("click", (e) => {
    if (e.target === detailModal) closeDetailModal();
  });

  /* ---------- List-your-skill modal ---------- */

  function openListingModal() {
    listingModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeListingModal() {
    listingModal.hidden = true;
    document.body.style.overflow = "";
    editingWorkerId = null;
    listingForm.reset();
    listingForm.querySelector("button[type=submit]").textContent = "Add me to the board";
  }

  openListingFormBtn.addEventListener("click", () => {
    // Listing a skill requires an account — same pattern the backend enforces.
    if (window.CampusGigsAuth && !window.CampusGigsAuth.requireLogin()) {
      return; // requireLogin() already opened the account modal
    }
    openListingModal();
  });
  closeListingFormBtn.addEventListener("click", closeListingModal);
  listingModal.addEventListener("click", (e) => {
    if (e.target === listingModal) closeListingModal();
  });

  listingForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const currentUser = window.CampusGigsAuth?.getCurrentUser();
    if (!currentUser) {
      listingConfirmation.textContent = "Please log in first.";
      return;
    }

    const name = document.getElementById("l-name").value.trim();
    const category = document.getElementById("l-category").value;
    const skill = document.getElementById("l-skill").value.trim();
    const bio = document.getElementById("l-bio").value.trim();
    const rate = Number(document.getElementById("l-rate").value);
    const distance = Number(document.getElementById("l-distance").value);

    if (!name || !category || !skill || !bio || !Number.isFinite(rate) || rate < 0 || !Number.isFinite(distance) || distance < 0) {
      listingConfirmation.textContent = "Please fill in every field with a valid value.";
      return;
    }

    const payload = {
      full_name: name,
      category,
      skill,
      bio,
      hourly_rate: rate,
      distance,
      owner_user_id: currentUser.id
    };

    const { error } = editingWorkerId
      ? await supabase.from("workers").update(payload).eq("id", editingWorkerId)
      : await supabase.from("workers").insert(payload);

    if (error) {
      listingConfirmation.textContent = error.message;
      return;
    }

    await loadWorkers();
    listingConfirmation.textContent = editingWorkerId
      ? "Listing updated."
      : "You're on the board! Scroll down to find your listing.";
    listingForm.reset();
    listingForm.querySelector("button[type=submit]").textContent = "Add me to the board";
    editingWorkerId = null;

    setTimeout(() => {
      closeListingModal();
      listingConfirmation.textContent = "";
    }, 1400);
  });

  function openEditWorkerForm(id) {
    const worker = workers.find((w) => w.id === id);
    if (!worker) return;

    document.getElementById("l-name").value = worker.name;
    document.getElementById("l-category").value = worker.category;
    document.getElementById("l-rate").value = worker.rate;
    document.getElementById("l-skill").value = worker.skill;
    document.getElementById("l-bio").value = worker.bio;
    document.getElementById("l-distance").value = worker.distance;
    editingWorkerId = id;
    listingForm.querySelector("button[type=submit]").textContent = "Save changes";
    openListingModal();
  }

  async function deleteWorker(id) {
    if (!confirm("Delete this listing? This can't be undone.")) return;
    const { error } = await supabase.from("workers").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    closeDetailModal();
    await loadWorkers();
  }

  /* ---------- Post-a-request form ---------- */

  requestForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (window.CampusGigsAuth && !window.CampusGigsAuth.requireLogin()) {
      return; // requireLogin() already opened the account modal
    }
    const currentUser = window.CampusGigsAuth?.getCurrentUser();

    const title = document.getElementById("req-title").value.trim();
    const category = document.getElementById("req-category").value;
    const budget = Number(document.getElementById("req-budget").value);
    const details = document.getElementById("req-details").value.trim();

    if (!title || !category || !details || !Number.isFinite(budget) || budget < 0) {
      requestConfirmation.textContent = "Please fill in every field with a valid value.";
      return;
    }

    const payload = {
      title,
      category,
      hourly_budget: budget,
      details,
      owner_user_id: currentUser.id
    };

    const { error } = editingRequestId
      ? await supabase.from("requests").update(payload).eq("id", editingRequestId)
      : await supabase.from("requests").insert(payload);

    if (error) {
      requestConfirmation.textContent = error.message;
    } else {
      requestConfirmation.textContent = editingRequestId
        ? "Request updated."
        : "Posted! People on the board matching that category can now see your request.";
      requestForm.reset();
      requestForm.querySelector("button[type=submit]").textContent = "Post to the board";
      editingRequestId = null;
      await loadRequests();
    }
    setTimeout(() => { requestConfirmation.textContent = ""; }, 4000);
  });

  /* ---------- Misc: escape key closes any open modal or sidebar ---------- */

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!detailModal.hidden) closeDetailModal();
    if (!listingModal.hidden) closeListingModal();
    if (document.getElementById("mobile-sidebar").classList.contains("is-open")) closeSidebar();
  });

  /* =========================================================
     MOBILE SIDEBAR — open/close, focus trap, button wiring
     HTML and CSS are already fully built; this is purely the
     JS layer that makes it interactive.
     ========================================================= */

  const sidebar        = document.getElementById("mobile-sidebar");
  const sidebarOverlay = document.getElementById("sidebar-overlay");
  const openSidebarBtn = document.getElementById("open-mobile-nav");
  const closeSidebarBtn = document.getElementById("close-mobile-nav");

  /** All focusable elements inside the sidebar, for focus trapping. */
  function getFocusableElements() {
    return Array.from(
      sidebar.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.closest("[hidden]"));
  }

  function openSidebar() {
    sidebar.classList.add("is-open");
    sidebar.setAttribute("aria-hidden", "false");

    // Remove hidden attribute before making visible (hidden prevents transitions).
    sidebarOverlay.removeAttribute("hidden");
    // Flush the removal so the browser registers the element before opacity starts.
    requestAnimationFrame(() => sidebarOverlay.classList.add("is-visible"));

    openSidebarBtn.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden"; // prevent scroll-behind

    // Move focus into the sidebar so keyboard/screen-reader users are in context.
    const firstFocusable = getFocusableElements()[0];
    if (firstFocusable) firstFocusable.focus();
  }

  function closeSidebar() {
    sidebar.classList.remove("is-open");
    sidebar.setAttribute("aria-hidden", "true");

    sidebarOverlay.classList.remove("is-visible");
    // Re-add hidden after the CSS opacity transition finishes (250ms in CSS).
    setTimeout(() => sidebarOverlay.setAttribute("hidden", ""), 260);

    openSidebarBtn.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";

    // Return focus to the trigger that opened the sidebar.
    openSidebarBtn.focus();
  }

  /** Focus trap: keep Tab/Shift+Tab cycling inside the sidebar while open. */
  sidebar.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusable = getFocusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  openSidebarBtn.addEventListener("click", openSidebar);
  closeSidebarBtn.addEventListener("click", closeSidebar);
  sidebarOverlay.addEventListener("click", closeSidebar);

  /** Sidebar search: mirrors the hero search bar. */
  const sidebarSearchForm  = document.getElementById("sidebar-search-form");
  const sidebarSearchInput = document.getElementById("sidebar-search-input");
  if (sidebarSearchForm) {
    sidebarSearchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const term = sidebarSearchInput.value.trim();
      if (term) {
        heroSearchInput.value = term;
        activeSearchTerm = term.toLowerCase();
        renderGrid();
      }
      closeSidebar();
      document.getElementById("browse").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  /** All sidebar nav links: close the sidebar when tapped, update active state. */
  sidebar.querySelectorAll("[data-sidebar-link]").forEach((el) => {
    el.addEventListener("click", () => {
      // Move the active highlight to whichever link was just clicked
      // (only for anchor links, not the button actions like login/logout).
      if (el.tagName === "A") {
        sidebar.querySelectorAll(".sidebar-link-active").forEach((a) => {
          a.classList.remove("sidebar-link-active");
        });
        el.classList.add("sidebar-link-active");
      }
      closeSidebar();
    });
  });

  /** Sidebar buttons that mirror the desktop header buttons. */

  // "Log in" / "Log out" button
  document.getElementById("sidebar-login-btn").addEventListener("click", () => {
    closeSidebar();
    const btn = document.getElementById("open-account-form");
    if (btn) btn.click();
  });

  // "List your skill" button
  document.getElementById("sidebar-list-skill-btn").addEventListener("click", () => {
    closeSidebar();
    const btn = document.getElementById("open-listing-form");
    if (btn) btn.click();
  });

  // "My profile" button (auth-only, hidden when logged out)
  document.getElementById("sidebar-profile-btn").addEventListener("click", () => {
    closeSidebar();
    if (window.CampusGigsProfile) window.CampusGigsProfile.showOwnProfile();
  });

  // "Messages" link (auth-only, hidden when logged out)
  document.getElementById("sidebar-messages-link").addEventListener("click", (e) => {
    e.preventDefault();
    closeSidebar();
    if (window.CampusGigsMessages) window.CampusGigsMessages.openMessages();
  });

  /* ---------- Footer year ---------- */

  document.getElementById("footer-year").textContent = new Date().getFullYear();

  /* ---------- Init ---------- */

  async function init() {
    // Wait for the initial Supabase session check to finish before doing
    // anything that depends on knowing who's logged in — this is what
    // fixes the old race condition where a logged-in user's first click
    // on "List your skill" right after page load could be treated as
    // logged-out.
    if (window.CampusGigsAuth) {
      await window.CampusGigsAuth.ready();
    }
    reflectAuthInNav();
    await Promise.all([loadWorkers(), loadRequests()]);
  }

  init();
})();