const state = {
  jobs: [],
  query: "",
  location: "",
  type: "all"
};

const elements = {
  form: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-input"),
  locationInput: document.querySelector("#location-input"),
  clearFilters: document.querySelector("#clear-filters"),
  filterChips: [...document.querySelectorAll(".filter-chip")],
  jobList: document.querySelector("#job-list"),
  template: document.querySelector("#job-card-template"),
  notice: document.querySelector("#notice"),
  totalJobs: document.querySelector("#total-jobs"),
  totalCompanies: document.querySelector("#total-companies"),
  lastUpdated: document.querySelector("#last-updated")
};

async function loadJobs() {
  try {
    const response = await fetch("./data/jobs.json", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Could not load jobs.json (${response.status})`);
    }

    const payload = await response.json();
    state.jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    updateStats(payload);

    if (payload.demo) {
      showNotice(
        "Showing demo listings. Run npm run sync:jobs to replace them with fetched career-page data."
      );
    }
  } catch (error) {
    state.jobs = [];
    updateStats({ jobs: [] });
    showNotice(`Job feed is not available yet. ${error.message}`);
  }

  renderJobs();
}

function updateStats(payload) {
  const companies = new Set(state.jobs.map((job) => job.company).filter(Boolean));
  elements.totalJobs.textContent = state.jobs.length.toLocaleString();
  elements.totalCompanies.textContent = companies.size.toLocaleString();
  elements.lastUpdated.textContent = formatDate(payload.generatedAt);
}

function showNotice(message) {
  elements.notice.hidden = false;
  elements.notice.textContent = message;
}

function hideNotice() {
  elements.notice.hidden = true;
  elements.notice.textContent = "";
}

function renderJobs() {
  elements.jobList.replaceChildren();
  const filteredJobs = filterJobs();

  if (filteredJobs.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "notice";
    emptyState.textContent = "No jobs match your filters yet. Try another keyword or location.";
    elements.jobList.append(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();

  filteredJobs.forEach((job) => {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    card.querySelector(".company").textContent = job.company || "Company";
    card.querySelector("h3").textContent = job.title || "Open role";
    card.querySelector(".job-type").textContent = job.type || "Role";
    card.querySelector(".job-meta").textContent = [job.location, formatDate(job.postedAt)]
      .filter(Boolean)
      .join(" • ");
    card.querySelector(".job-description").textContent =
      job.description || "View the original posting for the full job description.";
    card.querySelector(".source").textContent = job.sourceName || "Career page";

    const link = card.querySelector("a");
    link.href = job.applyUrl || job.sourceUrl || "#";
    link.setAttribute(
      "aria-label",
      `View original posting for ${job.title || "this role"} at ${job.company || "the employer"}`
    );

    fragment.append(card);
  });

  elements.jobList.append(fragment);
}

function filterJobs() {
  const query = state.query.trim().toLowerCase();
  const location = state.location.trim().toLowerCase();

  return state.jobs.filter((job) => {
    const text = [job.title, job.company, job.description, job.sourceName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const jobLocation = String(job.location || "").toLowerCase();
    const jobType = String(job.type || "").toLowerCase();

    const matchesQuery = !query || text.includes(query);
    const matchesLocation = !location || jobLocation.includes(location);
    const matchesType = state.type === "all" || jobType.includes(state.type);

    return matchesQuery && matchesLocation && matchesType;
  });
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "-";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return String(dateValue);
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  hideNotice();
  state.query = elements.searchInput.value;
  state.location = elements.locationInput.value;
  renderJobs();
});

elements.clearFilters.addEventListener("click", () => {
  state.query = "";
  state.location = "";
  state.type = "all";
  elements.searchInput.value = "";
  elements.locationInput.value = "";
  elements.filterChips.forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.filter === "all");
  });
  hideNotice();
  renderJobs();
});

elements.filterChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    state.type = chip.dataset.filter;
    elements.filterChips.forEach((item) => {
      item.classList.toggle("active", item === chip);
    });
    hideNotice();
    renderJobs();
  });
});

loadJobs();
