const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function getScrollBehavior() {
  return reducedMotion.matches ? "auto" : "smooth";
}

const table = document.querySelector(".table");
// Category pages list rows in editorial (README) order until a column is sorted
const defaultSort =
  table && table.dataset.defaultSort === "editorial"
    ? { col: "editorial", order: "asc" }
    : { col: "downloads", order: "desc" };
let activeSort = defaultSort;
const searchInput = document.querySelector(".search");
// The full placeholder is cut off on phones
if (searchInput && window.matchMedia("(max-width: 680px)").matches) {
  searchInput.placeholder = searchInput.dataset.shortPlaceholder;
}
const noResults = document.querySelector(".no-results");
let rows = Array.prototype.slice.call(
  document.querySelectorAll(".table tbody tr.row"),
);
const tbody = document.querySelector(".table tbody");
const groupRows = document.querySelectorAll(".table tbody tr.group-row");

// Smooth scroll without hash in URL
document.querySelectorAll("[data-scroll-to]").forEach(function (link) {
  link.addEventListener("click", function (e) {
    const el = document.getElementById(link.dataset.scrollTo);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: getScrollBehavior() });
  });
});

// Land at #library-index without leaving the hash in the URL
if (window.location.hash === "#library-index") {
  const target = document.getElementById("library-index");
  if (target) {
    target.scrollIntoView();
  }
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

function relativeTime(isoStr) {
  const date = new Date(isoStr);
  const now = new Date();
  const diffMs = now - date;
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffHours < 1) return "just now";
  if (diffHours < 24)
    return diffHours === 1 ? "1 hour ago" : diffHours + " hours ago";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return diffDays + " days ago";
  const diffMonths = Math.floor(diffDays / 30);
  if (diffDays < 365)
    return diffMonths === 1 ? "1 month ago" : diffMonths + " months ago";
  const diffYears = Math.floor(diffDays / 365);
  return diffYears === 1 ? "1 year ago" : diffYears + " years ago";
}

document.querySelectorAll(".col-commit[data-commit]").forEach(function (td) {
  const time = td.querySelector("time");
  if (time) time.textContent = relativeTime(td.dataset.commit);
});

document
  .querySelectorAll(".expand-commit time[datetime]")
  .forEach(function (time) {
    time.textContent = relativeTime(time.getAttribute("datetime"));
  });

let currentGroupRow = null;
Array.prototype.forEach.call(tbody ? tbody.rows : [], function (tr) {
  if (tr.classList.contains("group-row")) currentGroupRow = tr;
  else if (tr.classList.contains("row")) tr._groupRow = currentGroupRow;
});

rows.forEach(function (row, i) {
  row._origIndex = i;
  let next = row.nextElementSibling;
  if (next && next.classList.contains("desc-row")) {
    row._descRow = next;
    next = next.nextElementSibling;
  }
  row._expandRow = next;
});

function setRowOpen(row, open) {
  row.classList.toggle("open", open);
  row.setAttribute("aria-expanded", String(open));
  // The homepage shows a row's description only while the row is open
  if (isIndexDocument && row._descRow) row._descRow.hidden = !open;
}

function collapseAll() {
  if (!tbody) return;
  const openRows = tbody.querySelectorAll("tr.row.open");
  openRows.forEach(function (row) {
    setRowOpen(row, false);
  });
}

let activeSheetFilter = null;

function normalizeProjectKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function applyFilters() {
  const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
  const descRowsVisible = !isIndexDocument;
  let visibleCount = 0;

  collapseAll();

  // Number rows in their sorted DOM order, not the load order `rows` keeps
  const orderedRows = tbody ? tbody.querySelectorAll("tr.row") : rows;
  orderedRows.forEach(function (row) {
    let show = true;

    if (activeSheetFilter && activeSheetFilter.names.size > 0) {
      if (!row._normName) {
        const nameLink = row.querySelector(".col-name a");
        row._normName = normalizeProjectKey(nameLink ? nameLink.textContent : "");
      }
      if (!activeSheetFilter.names.has(row._normName)) {
        show = false;
      }
    }

    if (show && query) {
      if (!row._searchText) {
        let text = row.textContent.toLowerCase();
        if (row._descRow) {
          text += " " + row._descRow.textContent.toLowerCase();
        }
        if (row._expandRow) {
          text += " " + row._expandRow.textContent.toLowerCase();
        }
        row._searchText = text;
      }
      const terms = query.split(/\s+/).filter(Boolean);
      show = terms.every(function (term) {
        return row._searchText.includes(term);
      });
    }

    if (row.hidden !== !show) row.hidden = !show;
    if (row._descRow) {
      const descHidden = !show || !descRowsVisible;
      if (row._descRow.hidden !== descHidden) {
        row._descRow.hidden = descHidden;
      }
    }

    if (show) {
      visibleCount++;
      const numCell = row.cells[0];
      if (numCell.textContent !== String(visibleCount)) {
        numCell.textContent = String(visibleCount);
      }
    }
  });

  groupRows.forEach(function (groupRow) {
    groupRow.hidden = true;
  });
  if (activeSort.col === "editorial") {
    rows.forEach(function (row) {
      if (!row.hidden && row._groupRow) row._groupRow.hidden = false;
    });
  }

  if (noResults) noResults.hidden = visibleCount > 0;

  updateURL();
}

const isIndexDocument =
  location.pathname === "/" || location.pathname === "/index.html";

function buildQueryString() {
  const params = new URLSearchParams();
  const query = searchInput ? searchInput.value.trim() : "";
  if (query) params.set("q", query);
  if (activeSort.col !== defaultSort.col || activeSort.order !== defaultSort.order) {
    params.set("sort", activeSort.col);
    params.set("order", activeSort.order);
  }
  const qs = params.toString();
  return qs ? "?" + qs : "";
}

function updateURL() {
  if (!isIndexDocument) return;
  history.replaceState(null, "", "/" + buildQueryString());
}

function getSortValue(row, col) {
  // +1 keeps the first row above the "no value" cutoff in sortRows
  if (col === "editorial") return row._origIndex + 1;
  if (col === "name") {
    return row.querySelector(".col-name a").textContent.trim().toLowerCase();
  }
  if (col === "stars") {
    const text = row
      .querySelector(".col-stars")
      .textContent.trim()
      .replace(/,/g, "");
    const num = parseInt(text, 10);
    return isNaN(num) ? -1 : num;
  }
  if (col === "downloads") {
    const text = row
      .querySelector(".col-downloads")
      .textContent.trim()
      .replace(/,/g, "");
    const num = parseInt(text, 10);
    return isNaN(num) ? -1 : num;
  }
  if (col === "commit-time") {
    const attr = row.querySelector(".col-commit").getAttribute("data-commit");
    return attr ? new Date(attr).getTime() : 0;
  }
  return 0;
}

function sortRows() {
  if (!tbody) return;

  const arr = Array.prototype.slice.call(rows);
  const col = activeSort.col;
  const order = activeSort.order;

  // Cache sort values once to avoid DOM queries per comparison
  arr.forEach(function (row) {
    row._sortVal = getSortValue(row, col);
  });

  arr.sort(function (a, b) {
    const aVal = a._sortVal;
    const bVal = b._sortVal;
    if (col === "name") {
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      if (cmp === 0) return a._origIndex - b._origIndex;
      return order === "desc" ? -cmp : cmp;
    }
    if (aVal <= 0 && bVal <= 0) return a._origIndex - b._origIndex;
    if (aVal <= 0) return 1;
    if (bVal <= 0) return -1;
    const cmp = aVal - bVal;
    if (cmp === 0) return a._origIndex - b._origIndex;
    return order === "desc" ? -cmp : cmp;
  });

  const frag = document.createDocumentFragment();
  let lastGroupRow = null;
  arr.forEach(function (row) {
    if (col === "editorial" && row._groupRow && row._groupRow !== lastGroupRow) {
      frag.appendChild(row._groupRow);
      lastGroupRow = row._groupRow;
    }
    frag.appendChild(row);
    if (row._descRow) frag.appendChild(row._descRow);
    if (row._expandRow) frag.appendChild(row._expandRow);
  });
  tbody.appendChild(frag);
  applyFilters();
}

const sortHeaders = document.querySelectorAll("th[data-sort]");

function updateSortIndicators() {
  if (table) table.classList.toggle("sorted", activeSort.col !== "editorial");
  sortHeaders.forEach(function (th) {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === activeSort.col) {
      th.classList.add("sort-" + activeSort.order);
      th.setAttribute(
        "aria-sort",
        activeSort.order === "asc" ? "ascending" : "descending",
      );
    } else {
      th.removeAttribute("aria-sort");
    }
  });
}

if (tbody) {
  tbody.addEventListener("click", function (e) {
    if (e.target.closest("a")) return;

    let row = e.target.closest("tr.row");
    if (!row) {
      const descRow = e.target.closest("tr.desc-row");
      if (descRow) row = descRow.previousElementSibling;
    }
    if (!row) return;

    setRowOpen(row, !row.classList.contains("open"));
  });

  tbody.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("a")) return;
    const row = e.target.closest("tr.row");
    if (!row) return;
    e.preventDefault();
    row.click();
  });
}

const noResultsClear = document.querySelector(".no-results-clear");
if (noResultsClear) {
  noResultsClear.addEventListener("click", function () {
    if (!isIndexDocument) {
      window.location.href = "/";
      return;
    }
    if (searchInput) searchInput.value = "";
    activeSheetFilter = null;
    const activeFilterWrap = document.getElementById("sheets-active-filter");
    if (activeFilterWrap) activeFilterWrap.hidden = true;
    applyFilters();
  });
}

sortHeaders.forEach(function (th) {
  th.addEventListener("click", function () {
    const col = th.dataset.sort;
    const defaultOrder = col === "name" ? "asc" : "desc";
    const altOrder = defaultOrder === "asc" ? "desc" : "asc";
    if (activeSort.col === col) {
      if (activeSort.order === defaultOrder)
        activeSort = { col: col, order: altOrder };
      else activeSort = defaultSort;
    } else {
      activeSort = { col: col, order: defaultOrder };
    }
    sortRows();
    updateSortIndicators();
  });
});

function openEntryRow(row) {
  if (row.hidden && searchInput) {
    searchInput.value = "";
    applyFilters();
  }
  setRowOpen(row, true);
}

function openHashedRow() {
  const linkedRow = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (linkedRow && linkedRow.matches("tr.row")) openEntryRow(linkedRow);
}

// Editing the hash or going back/forward on the same page does not reload it
window.addEventListener("hashchange", openHashedRow);

// Group headings are hidden while sorted flat or filtered out by search, so a link to one must restore them first
document.addEventListener("click", function (e) {
  const link = e.target.closest('a[href*="#"]');
  if (!link || link.pathname !== location.pathname) return;
  const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
  if (target && target.matches("tr.row")) {
    openEntryRow(target);
    return;
  }
  const groupRow = target ? target.closest(".group-row") : null;
  if (!groupRow) return;
  if (activeSort.col !== "editorial") {
    activeSort = defaultSort;
    sortRows();
    updateSortIndicators();
  }
  if (groupRow.hidden && searchInput) {
    searchInput.value = "";
    applyFilters();
  }
});

// Mailto clicks leave no page view, so the sponsor funnel needs its own event
document.addEventListener("click", function (e) {
  const link = e.target.closest('a[href^="mailto:sponsorship@"]');
  if (!link || typeof gtag !== "function") return;
  gtag("event", "sponsor_contact", { tier: link.dataset.tier });
});

if (searchInput) {
  searchInput.addEventListener("input", function () {
    applyFilters();
  });

  searchInput.addEventListener("search", function () {
    applyFilters();
  });

  document.addEventListener("keydown", function (e) {
    if (
      e.key === "/" &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(
        document.activeElement.tagName,
      ) &&
      !document.activeElement.isContentEditable &&
      !e.isComposing &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if (e.key === "Escape" && document.activeElement === searchInput) {
      searchInput.value = "";
      applyFilters();
      searchInput.blur();
    }
  });
}

const backToTop = document.querySelector(".back-to-top");
const resultsSection = document.querySelector("#library-index");
const tableWrap = document.querySelector(".table-wrap");
const stickyHeaderCell = backToTop ? backToTop.closest("th") : null;

function updateBackToTopVisibility() {
  if (!backToTop || !tableWrap || !stickyHeaderCell) return;

  const tableRect = tableWrap.getBoundingClientRect();
  const headRect = stickyHeaderCell.getBoundingClientRect();
  const hasPassedHeader = tableRect.top <= 0 && headRect.bottom > 0;

  backToTop.classList.toggle("visible", hasPassedHeader);
}

if (backToTop) {
  let scrollTicking = false;
  window.addEventListener("scroll", function () {
    if (!scrollTicking) {
      requestAnimationFrame(function () {
        updateBackToTopVisibility();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  });

  window.addEventListener("resize", updateBackToTopVisibility);

  backToTop.addEventListener("click", function () {
    const target = searchInput || resultsSection;
    if (!target) return;
    target.scrollIntoView({ behavior: getScrollBehavior(), block: "center" });
    if (searchInput) searchInput.focus();
  });

  updateBackToTopVisibility();
}

(function () {
  const params = new URLSearchParams(location.search);
  const q = params.get("q");
  const sort = params.get("sort");
  const order = params.get("order");
  if (q && searchInput) searchInput.value = q;
  if (
    (sort === "name" ||
      sort === "stars" ||
      sort === "downloads" ||
      sort === "commit-time") &&
    (order === "desc" || order === "asc")
  ) {
    activeSort = { col: sort, order: order };
  }
  if (q || sort) {
    sortRows();
  } else if (searchInput && searchInput.value) {
    applyFilters();
  }
  updateSortIndicators();
  // Filtering collapses rows, so open a linked entry after restoring URL state.
  if (location.hash) openHashedRow();
})();

// Google Sheets & Google Drive Workspace Integration
(function initGoogleSheetsIntegration() {
  const signInBtn = document.getElementById("google-signin-btn");
  if (!signInBtn) return;

  const SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ];

  const FALLBACK_FIREBASE_CONFIG = {
    projectId: "gen-lang-client-0812398180",
    appId: "1:944668270532:web:49e0d24b960216ec32ce91",
    apiKey: "AIzaSyBpzk3dPC0gWmE58Ggu6tnZDMy9rfXs7Yg",
    authDomain: "gen-lang-client-0812398180.firebaseapp.com",
    storageBucket: "gen-lang-client-0812398180.firebasestorage.app",
    messagingSenderId: "944668270532",
    measurementId: "",
    oAuthClientId: "944668270532-30usdi4uvu2ntbu1t6k7nvpn45t7kodt.apps.googleusercontent.com",
    recaptchaSiteKey: "",
  };

  let cachedAccessToken = null;
  let isSigningIn = false;
  let firebaseAuthInstance = null;
  let firebaseAuthModule = null;
  let pendingMutation = null;
  let autoSyncTimer = null;

  const loggedOutGroup = document.getElementById("sheets-auth-logged-out");
  const loggedInGroup = document.getElementById("sheets-auth-logged-in");
  const userBadge = document.getElementById("sheets-user-badge");
  const signOutBtn = document.getElementById("google-signout-btn");
  const toggleWorkspaceBtn = document.getElementById("sheets-toggle-workspace-btn");
  const openExportBtn = document.getElementById("sheets-open-export-btn");
  const openExistingBtn = document.getElementById("sheets-open-existing-btn");
  const workspacePanel = document.getElementById("sheets-workspace-panel");
  const newTitleInput = document.getElementById("sheets-new-title");
  const prepareCreateBtn = document.getElementById("sheets-prepare-create-btn");
  const refreshFilesBtn = document.getElementById("sheets-refresh-files-btn");
  const fileSelect = document.getElementById("sheets-file-select");
  const customIdInput = document.getElementById("sheets-custom-id");
  const loadTabsBtn = document.getElementById("sheets-load-tabs-btn");
  const tabRow = document.getElementById("sheets-tab-row");
  const tabSelect = document.getElementById("sheets-tab-select");
  const syncIndexBtn = document.getElementById("sheets-sync-index-btn");
  const autoSyncBtn = document.getElementById("sheets-autosync-btn");
  const importFilterBtn = document.getElementById("sheets-import-filter-btn");
  const prepareOverwriteBtn = document.getElementById("sheets-prepare-overwrite-btn");
  const confirmDialog = document.getElementById("sheets-confirm-dialog");
  const confirmTitle = document.getElementById("sheets-confirm-title");
  const confirmDesc = document.getElementById("sheets-confirm-desc");
  const confirmProceedBtn = document.getElementById("sheets-confirm-proceed-btn");
  const confirmCancelBtn = document.getElementById("sheets-confirm-cancel-btn");
  const feedbackBox = document.getElementById("sheets-feedback");
  const feedbackMessage = document.getElementById("sheets-feedback-message");
  const feedbackLink = document.getElementById("sheets-feedback-link");
  const syncBadge = document.getElementById("sheets-sync-badge");
  const activeFilterWrap = document.getElementById("sheets-active-filter");
  const activeFilterLabel = document.getElementById("sheets-active-filter-label");
  const clearFilterBtn = document.getElementById("sheets-clear-filter-btn");

  function showFeedback(msg, url) {
    if (!feedbackBox || !feedbackMessage) return;
    feedbackMessage.textContent = msg;
    feedbackBox.hidden = false;
    if (feedbackLink) {
      if (url) {
        feedbackLink.href = url;
        feedbackLink.hidden = false;
      } else {
        feedbackLink.hidden = true;
      }
    }
  }

  function setWorkspaceOpen(open) {
    if (!workspacePanel) return;
    workspacePanel.hidden = !open;
    if (toggleWorkspaceBtn) {
      toggleWorkspaceBtn.setAttribute("aria-expanded", String(open));
      toggleWorkspaceBtn.classList.toggle("active", open);
    }
  }

  function updateAuthUI(user) {
    if (user) {
      if (loggedOutGroup) loggedOutGroup.hidden = true;
      if (loggedInGroup) loggedInGroup.hidden = false;
      if (userBadge) {
        userBadge.textContent = user.email || user.displayName || "Signed in";
      }
    } else {
      if (loggedOutGroup) loggedOutGroup.hidden = false;
      if (loggedInGroup) loggedInGroup.hidden = true;
      if (userBadge) userBadge.textContent = "";
    }
  }

  async function ensureFirebaseInitialized() {
    if (firebaseAuthInstance && firebaseAuthModule) {
      return { auth: firebaseAuthInstance, authMod: firebaseAuthModule };
    }
    let config = FALLBACK_FIREBASE_CONFIG;
    try {
      const resp = await fetch("/firebase-applet-config.json");
      if (resp.ok) {
        config = await resp.json();
      }
    } catch (_) {
      // Use fallback config
    }
    const appMod = await import("https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js");
    const authMod = await import("https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js");
    const app = appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(config);
    const auth = authMod.getAuth(app);
    authMod.onAuthStateChanged(auth, function (user) {
      if (!user) {
        cachedAccessToken = null;
      }
      updateAuthUI(user);
    });
    firebaseAuthInstance = auth;
    firebaseAuthModule = authMod;
    return { auth: auth, authMod: authMod };
  }

  async function googleSignIn() {
    if (isSigningIn) return null;
    isSigningIn = true;
    try {
      const { auth, authMod } = await ensureFirebaseInitialized();
      const provider = new authMod.GoogleAuthProvider();
      SCOPES.forEach(function (scope) {
        provider.addScope(scope);
      });
      const result = await authMod.signInWithPopup(auth, provider);
      const credential = authMod.GoogleAuthProvider.credentialFromResult(result);
      cachedAccessToken = credential ? credential.accessToken : null;
      updateAuthUI(result.user);
      setWorkspaceOpen(true);
      showFeedback("Connected to Google Workspace. You can now export, read, or sync spreadsheets.");
      loadDriveSpreadsheets(false);
      return cachedAccessToken;
    } catch (error) {
      if (error && error.code === "auth/cancelled-popup-request") {
        return null;
      }
      showFeedback(
        "Google Sign-In could not complete: " +
          (error && error.message ? error.message : "Popup closed or blocked."),
      );
      return null;
    } finally {
      isSigningIn = false;
    }
  }

  async function getAccessToken() {
    if (cachedAccessToken) return cachedAccessToken;
    return await googleSignIn();
  }

  async function googleApiFetch(url, options) {
    let token = await getAccessToken();
    if (!token) {
      throw new Error("Please sign in with Google to access Google Sheets.");
    }
    const reqOptions = Object.assign({}, options || {});
    reqOptions.headers = Object.assign({}, reqOptions.headers || {}, {
      Authorization: "Bearer " + token,
    });
    let response = await fetch(url, reqOptions);
    if (response.status === 401) {
      cachedAccessToken = null;
      token = await googleSignIn();
      if (!token) {
        throw new Error("Session expired. Please sign in with Google again.");
      }
      reqOptions.headers.Authorization = "Bearer " + token;
      response = await fetch(url, reqOptions);
    }
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errJson = await response.json();
        if (errJson && errJson.error && errJson.error.message) {
          detail = errJson.error.message;
        }
      } catch (_) {}
      throw new Error("Google API error (" + response.status + "): " + detail);
    }
    return response.json();
  }

  function extractSpreadsheetId(rawInput) {
    const trimmed = String(rawInput || "").trim();
    if (!trimmed) return "";
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : trimmed;
  }

  function getSelectedSpreadsheetId() {
    const customVal = customIdInput ? extractSpreadsheetId(customIdInput.value) : "";
    if (customVal) return customVal;
    return fileSelect ? fileSelect.value : "";
  }

  function getSelectedSpreadsheetLabel() {
    const customVal = customIdInput ? extractSpreadsheetId(customIdInput.value) : "";
    if (customVal) return customVal;
    if (fileSelect && fileSelect.selectedIndex > 0) {
      return fileSelect.options[fileSelect.selectedIndex].textContent;
    }
    return "Selected Spreadsheet";
  }

  function collectVisibleTableRows() {
    const data = [
      [
        "Project Name",
        "Repository / Docs URL",
        "PyPI Downloads (30d)",
        "GitHub Stars",
        "Last Commit",
        "Tags",
        "Description",
      ],
    ];
    const orderedRows = tbody ? tbody.querySelectorAll("tr.row") : rows;
    orderedRows.forEach(function (row) {
      if (row.hidden) return;
      const nameLink = row.querySelector(".col-name a");
      const name = nameLink ? nameLink.textContent.trim() : "";
      const url = nameLink ? nameLink.href : "";
      const dlCell = row.querySelector(".col-downloads");
      const downloads = dlCell ? dlCell.textContent.trim() : "";
      const starsCell = row.querySelector(".col-stars");
      const stars = starsCell ? starsCell.textContent.trim() : "";
      const commitCell = row.querySelector(".col-commit");
      const commitIso = commitCell
        ? commitCell.getAttribute("data-commit") || commitCell.textContent.trim()
        : "";
      const tagEls = row.querySelectorAll(".col-cat .tag");
      const tags = Array.prototype.map
        .call(tagEls, function (t) {
          return t.textContent.trim();
        })
        .join(", ");
      let desc = "";
      if (row._descRow) {
        const descEl = row._descRow.querySelector(".desc-text");
        desc = descEl ? descEl.textContent.replace(/\s+/g, " ").trim() : "";
      } else if (row._expandRow) {
        const expEl = row._expandRow.querySelector(".expand-content");
        desc = expEl ? expEl.textContent.replace(/\s+/g, " ").trim() : "";
      }
      data.push([name, url, downloads, stars, commitIso, tags, desc]);
    });
    return data;
  }

  function parseNumericMetric(raw) {
    const cleaned = String(raw || "")
      .trim()
      .replace(/,/g, "")
      .replace(/_/g, "");
    if (!cleaned || !/^\d+$/.test(cleaned)) return null;
    return parseInt(cleaned, 10);
  }

  function parseSheetProjectRows(values) {
    if (!Array.isArray(values) || !values.length) return [];
    const headerAliases = {
      projectname: "name",
      name: "name",
      project: "name",
      library: "name",
      repositorydocsurl: "url",
      repositoryurl: "url",
      url: "url",
      link: "url",
      homepage: "url",
      pypidownloads30d: "downloads",
      pypidownloads: "downloads",
      downloads: "downloads",
      githubstars: "stars",
      stars: "stars",
      lastcommit: "last_commit_at",
      lastcommitat: "last_commit_at",
      commit: "last_commit_at",
      tags: "tags",
      categories: "tags",
      category: "tags",
      description: "description",
      summary: "description",
    };

    const colMap = {
      name: 0,
      url: 1,
      downloads: 2,
      stars: 3,
      last_commit_at: 4,
      tags: 5,
      description: 6,
    };

    let startIdx = 0;
    const firstRow = values[0] || [];
    const firstCellNorm = normalizeProjectKey(firstRow[0] || "");
    let headerMatches = 0;
    firstRow.forEach(function (cell) {
      if (headerAliases[normalizeProjectKey(cell)]) headerMatches++;
    });
    if (
      firstCellNorm === "projectname" ||
      firstCellNorm === "name" ||
      firstCellNorm === "project" ||
      headerMatches >= 2
    ) {
      startIdx = 1;
      const detected = {};
      firstRow.forEach(function (cell, idx) {
        const field = headerAliases[normalizeProjectKey(cell)];
        if (field && detected[field] === undefined) {
          detected[field] = idx;
        }
      });
      if (detected.name !== undefined) {
        Object.assign(colMap, detected);
      }
    }

    const parsed = [];
    const seen = new Set();
    for (let i = startIdx; i < values.length; i++) {
      const rowArr = values[i] || [];
      const getVal = function (field) {
        const idx = colMap[field];
        return idx !== undefined && idx >= 0 && idx < rowArr.length && rowArr[idx] !== null && rowArr[idx] !== undefined
          ? String(rowArr[idx]).trim()
          : "";
      };
      const name = getVal("name");
      if (!name) continue;
      const normKey = normalizeProjectKey(name);
      if (!normKey || seen.has(normKey)) continue;
      seen.add(normKey);

      const url = getVal("url") || "https://pypi.org/project/" + encodeURIComponent(name) + "/";
      const downloads = parseNumericMetric(getVal("downloads"));
      const stars = parseNumericMetric(getVal("stars"));
      const lastCommitAt = getVal("last_commit_at");
      const rawTags = getVal("tags");
      const tags = rawTags
        ? rawTags
            .split(",")
            .map(function (t) {
              return t.trim();
            })
            .filter(Boolean)
        : [];
      const description = getVal("description");

      parsed.push({
        name: name,
        normKey: normKey,
        url: url,
        downloads: downloads,
        stars: stars,
        lastCommitAt: lastCommitAt,
        tags: tags,
        description: description,
      });
    }
    return parsed;
  }

  function buildTagHrefMap() {
    const map = {};
    document.querySelectorAll(".col-cat a.tag").forEach(function (a) {
      const label = a.textContent.trim();
      if (label && !map[label]) {
        map[label] = a.getAttribute("href") || "#library-index";
      }
    });
    return map;
  }

  function applySheetProjectsToLibraryIndex(sheetProjects, tabTitle) {
    if (!tbody || !Array.isArray(sheetProjects) || !sheetProjects.length) {
      return { updated: 0, added: 0, total: 0 };
    }

    const tagHrefMap = buildTagHrefMap();
    const existingByKey = {};
    rows.forEach(function (row) {
      const nameLink = row.querySelector(".col-name a");
      const key = normalizeProjectKey(nameLink ? nameLink.textContent : "");
      if (key) existingByKey[key] = row;
    });

    let updatedCount = 0;
    let addedCount = 0;

    sheetProjects.forEach(function (sp) {
      const existingRow = existingByKey[sp.normKey];
      if (existingRow) {
        const nameLink = existingRow.querySelector(".col-name a");
        if (nameLink) {
          nameLink.textContent = sp.name;
          if (sp.url) nameLink.href = sp.url;
        }
        if (sp.downloads !== null) {
          const dlCell = existingRow.querySelector(".col-downloads");
          if (dlCell) dlCell.textContent = sp.downloads.toLocaleString("en-US");
        }
        if (sp.stars !== null) {
          const starsCell = existingRow.querySelector(".col-stars");
          if (starsCell) starsCell.textContent = sp.stars.toLocaleString("en-US");
        }
        if (sp.lastCommitAt) {
          const commitCell = existingRow.querySelector(".col-commit");
          if (commitCell) {
            commitCell.setAttribute("data-commit", sp.lastCommitAt);
            commitCell.innerHTML = "";
            const timeEl = document.createElement("time");
            timeEl.setAttribute("datetime", sp.lastCommitAt);
            timeEl.textContent = relativeTime(sp.lastCommitAt);
            commitCell.appendChild(timeEl);
          }
        }
        if (sp.description && existingRow._descRow) {
          const descText = existingRow._descRow.querySelector(".desc-text");
          if (descText) descText.textContent = sp.description;
        }
        existingRow._searchText = null;
        existingRow._normName = sp.normKey;
        updatedCount++;
      } else {
        const nextIdx = rows.length + 1;
        const expandId = "expand-sheet-" + nextIdx;

        const tr = document.createElement("tr");
        tr.className = "row";
        tr.setAttribute("tabindex", "0");
        tr.setAttribute("aria-expanded", "false");
        tr.setAttribute("aria-controls", expandId);
        tr.dataset.sheetSynced = "true";

        const tdNum = document.createElement("td");
        tdNum.className = "col-num";
        tdNum.textContent = String(nextIdx);

        const tdName = document.createElement("td");
        tdName.className = "col-name";
        const aName = document.createElement("a");
        aName.href = sp.url;
        aName.target = "_blank";
        aName.rel = "noopener";
        aName.textContent = sp.name;
        const mobileCat = document.createElement("span");
        mobileCat.className = "mobile-cat";
        mobileCat.textContent = sp.tags[0] || "Google Sheet";
        tdName.appendChild(aName);
        tdName.appendChild(mobileCat);

        const tdDl = document.createElement("td");
        tdDl.className = "col-downloads";
        if (sp.downloads !== null) {
          tdDl.textContent = sp.downloads.toLocaleString("en-US");
        } else {
          const badge = document.createElement("span");
          badge.className = "source-badge";
          badge.textContent = "Sheet";
          tdDl.appendChild(badge);
        }

        const tdStars = document.createElement("td");
        tdStars.className = "col-stars";
        if (sp.stars !== null) {
          tdStars.textContent = sp.stars.toLocaleString("en-US");
        } else {
          tdStars.textContent = "—";
        }

        const tdCommit = document.createElement("td");
        tdCommit.className = "col-commit";
        if (sp.lastCommitAt) {
          tdCommit.setAttribute("data-commit", sp.lastCommitAt);
          const timeEl = document.createElement("time");
          timeEl.setAttribute("datetime", sp.lastCommitAt);
          timeEl.textContent = relativeTime(sp.lastCommitAt);
          tdCommit.appendChild(timeEl);
        } else {
          tdCommit.textContent = "—";
        }

        const tdCat = document.createElement("td");
        tdCat.className = "col-cat";
        const tagsToRender = sp.tags.length ? sp.tags : ["Google Sheet"];
        tagsToRender.forEach(function (tagName) {
          const tagLink = document.createElement("a");
          tagLink.className = "tag";
          tagLink.href = tagHrefMap[tagName] || "#library-index";
          tagLink.textContent = tagName;
          tdCat.appendChild(tagLink);
        });

        const tdArrow = document.createElement("td");
        tdArrow.className = "col-arrow";
        const spanArrow = document.createElement("span");
        spanArrow.className = "arrow";
        spanArrow.setAttribute("aria-hidden", "true");
        spanArrow.textContent = "→";
        tdArrow.appendChild(spanArrow);

        tr.appendChild(tdNum);
        tr.appendChild(tdName);
        tr.appendChild(tdDl);
        tr.appendChild(tdStars);
        tr.appendChild(tdCommit);
        tr.appendChild(tdCat);
        tr.appendChild(tdArrow);

        const descTr = document.createElement("tr");
        descTr.className = "desc-row";
        if (isIndexDocument) descTr.hidden = true;
        const descTdNum = document.createElement("td");
        descTdNum.className = "col-num";
        const descTdBody = document.createElement("td");
        descTdBody.colSpan = 6;
        const descDiv = document.createElement("div");
        descDiv.className = "desc-text";
        descDiv.textContent = sp.description || "Synced from Google Sheet.";
        descTdBody.appendChild(descDiv);
        descTr.appendChild(descTdNum);
        descTr.appendChild(descTdBody);

        const expTr = document.createElement("tr");
        expTr.className = "expand-row";
        expTr.id = expandId;
        const expTdLead = document.createElement("td");
        const expTdMain = document.createElement("td");
        expTdMain.colSpan = 5;
        const expContent = document.createElement("div");
        expContent.className = "expand-content";
        const expMeta = document.createElement("div");
        expMeta.className = "expand-meta";
        const expUrlLink = document.createElement("a");
        expUrlLink.href = sp.url;
        expUrlLink.target = "_blank";
        expUrlLink.rel = "noopener";
        expUrlLink.textContent = sp.url.replace(/^https?:\/\//, "");
        expMeta.appendChild(expUrlLink);
        expContent.appendChild(expMeta);
        expTdMain.appendChild(expContent);
        const expTdTrail = document.createElement("td");
        expTr.appendChild(expTdLead);
        expTr.appendChild(expTdMain);
        expTr.appendChild(expTdTrail);

        tr._origIndex = rows.length;
        tr._descRow = descTr;
        tr._expandRow = expTr;
        tr._normName = sp.normKey;

        tbody.appendChild(tr);
        tbody.appendChild(descTr);
        tbody.appendChild(expTr);
        rows.push(tr);
        existingByKey[sp.normKey] = tr;
        addedCount++;
      }
    });

    if (searchInput && addedCount > 0) {
      const totalCount = rows.length;
      searchInput.placeholder = searchInput.placeholder.replace(
        /^Search \d+/,
        "Search " + totalCount,
      );
      if (searchInput.dataset.shortPlaceholder) {
        searchInput.dataset.shortPlaceholder =
          searchInput.dataset.shortPlaceholder.replace(
            /^Search \d+/,
            "Search " + totalCount,
          );
      }
    }

    sortRows();

    if (syncBadge) {
      syncBadge.textContent =
        "Synced " +
        sheetProjects.length +
        ' from "' +
        (tabTitle || "Sheet") +
        '"' +
        (autoSyncTimer ? " (auto-sync on)" : "");
      syncBadge.hidden = false;
    }

    return {
      updated: updatedCount,
      added: addedCount,
      total: sheetProjects.length,
    };
  }

  async function syncSheetIntoLibraryIndex(silent) {
    const spreadsheetId = getSelectedSpreadsheetId();
    const tabTitle = tabSelect ? tabSelect.value : "";
    if (!spreadsheetId || !tabTitle) {
      if (!silent) {
        showFeedback("Load and select a sheet tab first to sync into the library index.");
      }
      return null;
    }
    try {
      if (!silent) {
        showFeedback(
          'Syncing project data from "' + tabTitle + '" into the library index…',
        );
      }
      const safeTab = "'" + tabTitle.replace(/'/g, "''") + "'!A1:G2000";
      const readUrl =
        "https://sheets.googleapis.com/v4/spreadsheets/" +
        encodeURIComponent(spreadsheetId) +
        "/values/" +
        encodeURIComponent(safeTab);
      const data = await googleApiFetch(readUrl);
      const values = (data && data.values) || [];
      const parsedProjects = parseSheetProjectRows(values);
      if (!parsedProjects.length) {
        if (!silent) {
          showFeedback('No project rows found in "' + tabTitle + '".');
        }
        return null;
      }
      const stats = applySheetProjectsToLibraryIndex(parsedProjects, tabTitle);
      if (!silent) {
        showFeedback(
          "Synced " +
            stats.total +
            ' project(s) from "' +
            tabTitle +
            '" into the library index (' +
            stats.updated +
            " updated, " +
            stats.added +
            " added).",
          "https://docs.google.com/spreadsheets/d/" + spreadsheetId,
        );
      }
      return stats;
    } catch (err) {
      if (!silent) {
        showFeedback(err.message || "Could not sync project data from the selected tab.");
      }
      return null;
    }
  }

  function stopBackgroundSheetSync() {
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
    if (autoSyncBtn) {
      autoSyncBtn.setAttribute("aria-pressed", "false");
      autoSyncBtn.classList.remove("active");
      autoSyncBtn.textContent = "Background auto-sync: Off";
    }
  }

  function startBackgroundSheetSync(intervalMs) {
    const spreadsheetId = getSelectedSpreadsheetId();
    const tabTitle = tabSelect ? tabSelect.value : "";
    if (!spreadsheetId || !tabTitle) {
      showFeedback("Select a spreadsheet and sheet tab before starting background auto-sync.");
      return false;
    }
    if (autoSyncTimer) clearInterval(autoSyncTimer);
    const pollMs = intervalMs || 30000;
    autoSyncTimer = setInterval(function () {
      if (document.visibilityState !== "hidden") {
        syncSheetIntoLibraryIndex(true);
      }
    }, pollMs);
    if (autoSyncBtn) {
      autoSyncBtn.setAttribute("aria-pressed", "true");
      autoSyncBtn.classList.add("active");
      autoSyncBtn.textContent = "Background auto-sync: On";
    }
    syncSheetIntoLibraryIndex(false);
    return true;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && autoSyncTimer) {
      syncSheetIntoLibraryIndex(true);
    }
  });

  async function loadDriveSpreadsheets(interactive) {
    try {
      if (interactive) {
        showFeedback("Loading your Google Spreadsheets from Drive…");
      }
      const query = encodeURIComponent(
        "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      );
      const url =
        "https://www.googleapis.com/drive/v3/files?q=" +
        query +
        "&fields=files(id,name,modifiedTime,webViewLink)&pageSize=25&orderBy=modifiedTime desc";
      const data = await googleApiFetch(url);
      const files = (data && data.files) || [];
      if (fileSelect) {
        fileSelect.innerHTML =
          '<option value="">Select a spreadsheet from Drive…</option>';
        files.forEach(function (f) {
          const opt = document.createElement("option");
          opt.value = f.id;
          opt.textContent = f.name;
          fileSelect.appendChild(opt);
        });
      }
      if (interactive) {
        showFeedback(
          files.length
            ? "Loaded " + files.length + " spreadsheets from your Google Drive."
            : "No spreadsheets found in your Google Drive yet.",
        );
      }
    } catch (err) {
      if (interactive) {
        showFeedback(err.message || "Could not load spreadsheets from Drive.");
      }
    }
  }

  async function loadSpreadsheetTabs() {
    const spreadsheetId = getSelectedSpreadsheetId();
    if (!spreadsheetId) {
      showFeedback("Select a spreadsheet from Drive or paste a Spreadsheet URL/ID first.");
      return;
    }
    try {
      showFeedback("Fetching sheet tabs from spreadsheet…");
      const metaUrl =
        "https://sheets.googleapis.com/v4/spreadsheets/" +
        encodeURIComponent(spreadsheetId) +
        "?includeGridData=false";
      const meta = await googleApiFetch(metaUrl);
      const sheets = (meta && meta.sheets) || [];
      if (!sheets.length) {
        showFeedback("No sheet tabs found in the selected spreadsheet.");
        return;
      }
      if (tabSelect) {
        tabSelect.innerHTML = "";
        sheets.forEach(function (s) {
          const title = s.properties && s.properties.title ? s.properties.title : "";
          if (!title) return;
          const opt = document.createElement("option");
          opt.value = title;
          opt.textContent = title;
          tabSelect.appendChild(opt);
        });
      }
      if (tabRow) tabRow.hidden = false;
      const docTitle =
        meta.properties && meta.properties.title
          ? meta.properties.title
          : spreadsheetId;
      showFeedback(
        'Loaded ' +
          sheets.length +
          ' sheet tab(s) from "' +
          docTitle +
          '". Choose a tab to sync into the library index, filter the table, or write visible rows.',
        meta.spreadsheetUrl ||
          "https://docs.google.com/spreadsheets/d/" + spreadsheetId,
      );
    } catch (err) {
      showFeedback(err.message || "Failed to load spreadsheet metadata.");
    }
  }

  async function importFilterFromTab() {
    const spreadsheetId = getSelectedSpreadsheetId();
    const tabTitle = tabSelect ? tabSelect.value : "";
    if (!spreadsheetId || !tabTitle) {
      showFeedback("Load and select a sheet tab first.");
      return;
    }
    try {
      showFeedback('Reading project names from "' + tabTitle + '" (column A)…');
      const safeTab = "'" + tabTitle.replace(/'/g, "''") + "'!A1:A1000";
      const readUrl =
        "https://sheets.googleapis.com/v4/spreadsheets/" +
        encodeURIComponent(spreadsheetId) +
        "/values/" +
        encodeURIComponent(safeTab);
      const data = await googleApiFetch(readUrl);
      const values = (data && data.values) || [];
      const namesSet = new Set();
      values.forEach(function (rowArr, idx) {
        const cell = rowArr && rowArr[0] ? String(rowArr[0]).trim() : "";
        if (!cell) return;
        const norm = normalizeProjectKey(cell);
        if (idx === 0 && (norm === "projectname" || norm === "name" || norm === "project")) {
          return;
        }
        if (norm) namesSet.add(norm);
      });
      if (!namesSet.size) {
        showFeedback('No project names found in column A of "' + tabTitle + '".');
        return;
      }
      activeSheetFilter = {
        title: tabTitle,
        names: namesSet,
      };
      if (activeFilterLabel) {
        activeFilterLabel.textContent =
          'Filtered by Sheet tab "' + tabTitle + '" (' + namesSet.size + " names)";
      }
      if (activeFilterWrap) activeFilterWrap.hidden = false;
      applyFilters();
      showFeedback(
        'Applied filter from tab "' +
          tabTitle +
          '" (' +
          namesSet.size +
          " project names in column A).",
        "https://docs.google.com/spreadsheets/d/" + spreadsheetId,
      );
    } catch (err) {
      showFeedback(err.message || "Could not read values from the selected tab.");
    }
  }

  function openConfirmation(mutation) {
    pendingMutation = mutation;
    if (!confirmDialog || !confirmTitle || !confirmDesc) return;
    confirmTitle.textContent = mutation.dialogTitle;
    confirmDesc.textContent = mutation.dialogDesc;
    confirmDialog.hidden = false;
    if (confirmProceedBtn) confirmProceedBtn.focus();
  }

  function closeConfirmation() {
    pendingMutation = null;
    if (confirmDialog) confirmDialog.hidden = true;
  }

  async function executePendingMutation() {
    if (!pendingMutation) return;
    const mutation = pendingMutation;
    closeConfirmation();

    if (mutation.type === "create") {
      try {
        showFeedback('Creating new Google Spreadsheet "' + mutation.title + '"…');
        const created = await googleApiFetch(
          "https://sheets.googleapis.com/v4/spreadsheets",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              properties: { title: mutation.title },
            }),
          },
        );
        const spreadsheetId = created.spreadsheetId;
        const firstTabTitle =
          created.sheets &&
          created.sheets[0] &&
          created.sheets[0].properties &&
          created.sheets[0].properties.title
            ? created.sheets[0].properties.title
            : "Sheet1";
        const safeRange = "'" + firstTabTitle.replace(/'/g, "''") + "'!A1";
        await googleApiFetch(
          "https://sheets.googleapis.com/v4/spreadsheets/" +
            encodeURIComponent(spreadsheetId) +
            "/values/" +
            encodeURIComponent(safeRange) +
            "?valueInputOption=USER_ENTERED",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              values: mutation.rowsData,
            }),
          },
        );
        const sheetUrl =
          created.spreadsheetUrl ||
          "https://docs.google.com/spreadsheets/d/" + spreadsheetId;
        showFeedback(
          'Exported ' +
            (mutation.rowsData.length - 1) +
            ' projects to "' +
            mutation.title +
            '".',
          sheetUrl,
        );
        loadDriveSpreadsheets(false);
      } catch (err) {
        showFeedback(err.message || "Failed to create and populate spreadsheet.");
      }
    } else if (mutation.type === "overwrite") {
      try {
        showFeedback(
          'Writing ' +
            (mutation.rowsData.length - 1) +
            ' projects to tab "' +
            mutation.tabTitle +
            '"…',
        );
        const safeTabRange = "'" + mutation.tabTitle.replace(/'/g, "''") + "'!A1:Z2000";
        await googleApiFetch(
          "https://sheets.googleapis.com/v4/spreadsheets/" +
            encodeURIComponent(mutation.spreadsheetId) +
            "/values/" +
            encodeURIComponent(safeTabRange) +
            ":clear",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
        );
        const writeRange = "'" + mutation.tabTitle.replace(/'/g, "''") + "'!A1";
        await googleApiFetch(
          "https://sheets.googleapis.com/v4/spreadsheets/" +
            encodeURIComponent(mutation.spreadsheetId) +
            "/values/" +
            encodeURIComponent(writeRange) +
            "?valueInputOption=USER_ENTERED",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              values: mutation.rowsData,
            }),
          },
        );
        showFeedback(
          'Updated tab "' +
            mutation.tabTitle +
            '" with ' +
            (mutation.rowsData.length - 1) +
            " visible projects.",
          "https://docs.google.com/spreadsheets/d/" + mutation.spreadsheetId,
        );
      } catch (err) {
        showFeedback(err.message || "Failed to update the selected tab.");
      }
    }
  }

  signInBtn.addEventListener("click", function () {
    googleSignIn();
  });

  if (signOutBtn) {
    signOutBtn.addEventListener("click", async function () {
      stopBackgroundSheetSync();
      try {
        const { auth, authMod } = await ensureFirebaseInitialized();
        await authMod.signOut(auth);
      } catch (_) {}
      cachedAccessToken = null;
      updateAuthUI(null);
      closeConfirmation();
      showFeedback("Signed out of Google Workspace.");
    });
  }

  if (toggleWorkspaceBtn) {
    toggleWorkspaceBtn.addEventListener("click", function () {
      const isHidden = workspacePanel ? workspacePanel.hidden : true;
      setWorkspaceOpen(isHidden);
    });
  }

  if (openExportBtn) {
    openExportBtn.addEventListener("click", function () {
      setWorkspaceOpen(true);
      if (newTitleInput) newTitleInput.focus();
    });
  }

  if (openExistingBtn) {
    openExistingBtn.addEventListener("click", function () {
      setWorkspaceOpen(true);
      loadDriveSpreadsheets(true);
      if (fileSelect) fileSelect.focus();
    });
  }

  if (refreshFilesBtn) {
    refreshFilesBtn.addEventListener("click", function () {
      loadDriveSpreadsheets(true);
    });
  }

  if (fileSelect) {
    fileSelect.addEventListener("change", function () {
      stopBackgroundSheetSync();
      if (fileSelect.value && customIdInput) {
        customIdInput.value = "";
      }
      if (tabRow) tabRow.hidden = true;
    });
  }

  if (loadTabsBtn) {
    loadTabsBtn.addEventListener("click", function () {
      loadSpreadsheetTabs();
    });
  }

  if (syncIndexBtn) {
    syncIndexBtn.addEventListener("click", function () {
      syncSheetIntoLibraryIndex(false);
    });
  }

  if (autoSyncBtn) {
    autoSyncBtn.addEventListener("click", function () {
      if (autoSyncTimer) {
        stopBackgroundSheetSync();
        showFeedback("Stopped background Google Sheet auto-sync.");
      } else {
        startBackgroundSheetSync(30000);
      }
    });
  }

  if (importFilterBtn) {
    importFilterBtn.addEventListener("click", function () {
      importFilterFromTab();
    });
  }

  if (clearFilterBtn) {
    clearFilterBtn.addEventListener("click", function () {
      activeSheetFilter = null;
      if (activeFilterWrap) activeFilterWrap.hidden = true;
      applyFilters();
      showFeedback("Cleared Google Sheet filter.");
    });
  }

  if (prepareCreateBtn) {
    prepareCreateBtn.addEventListener("click", function () {
      const title =
        newTitleInput && newTitleInput.value.trim()
          ? newTitleInput.value.trim()
          : "Awesome Python Shortlist";
      const rowsData = collectVisibleTableRows();
      const projectCount = rowsData.length - 1;
      openConfirmation({
        type: "create",
        title: title,
        rowsData: rowsData,
        dialogTitle: "Confirm new Google Spreadsheet creation",
        dialogDesc:
          'Create a new spreadsheet titled "' +
          title +
          '" in your Google Drive and write ' +
          projectCount +
          " visible project row" +
          (projectCount === 1 ? "" : "s") +
          " to its first sheet tab?",
      });
    });
  }

  if (prepareOverwriteBtn) {
    prepareOverwriteBtn.addEventListener("click", function () {
      const spreadsheetId = getSelectedSpreadsheetId();
      const tabTitle = tabSelect ? tabSelect.value : "";
      if (!spreadsheetId || !tabTitle) {
        showFeedback("Select a spreadsheet and load a sheet tab first.");
        return;
      }
      const rowsData = collectVisibleTableRows();
      const projectCount = rowsData.length - 1;
      const sheetLabel = getSelectedSpreadsheetLabel();
      openConfirmation({
        type: "overwrite",
        spreadsheetId: spreadsheetId,
        tabTitle: tabTitle,
        rowsData: rowsData,
        dialogTitle: "Confirm Google Sheet tab update",
        dialogDesc:
          "Clear and write " +
          projectCount +
          " visible project row" +
          (projectCount === 1 ? "" : "s") +
          ' to tab "' +
          tabTitle +
          '" in "' +
          sheetLabel +
          '"?',
      });
    });
  }

  if (confirmProceedBtn) {
    confirmProceedBtn.addEventListener("click", function () {
      executePendingMutation();
    });
  }

  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener("click", function () {
      closeConfirmation();
      showFeedback("Cancelled Google Sheets update.");
    });
  }

  window.AwesomePythonSheetsSync = {
    parseSheetProjectRows: parseSheetProjectRows,
    applySheetProjectsToLibraryIndex: applySheetProjectsToLibraryIndex,
    syncNow: syncSheetIntoLibraryIndex,
    startAutoSync: startBackgroundSheetSync,
    stopAutoSync: stopBackgroundSheetSync,
  };

  ensureFirebaseInitialized().catch(function () {});
})();

