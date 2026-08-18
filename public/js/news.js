import { api, el } from "./common.js";

const container = document.querySelector("[data-news-list]");

function formatDate(value) {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function loadNews() {
  if (!container) return;

  try {
    const { news } = await api("/api/news");

    container.replaceChildren();

    if (news.length === 0) {
      container.append(el("p", "muted", "Новостей пока нет."));
      return;
    }

    for (const item of news) {
      const article = el("article");

      const photo = el("div", "ph");
      if (item.image_path) {
        const img = document.createElement("img");
        img.src = item.image_path;
        img.alt = item.title;
        photo.append(img);
      } else {
        photo.append(el("span", null, "без фото"));
      }
      article.append(photo);

      const time = document.createElement("time");
      time.textContent = formatDate(item.published_at);
      article.append(time);

      article.append(el("h3", null, item.title));
      if (item.excerpt) {
        article.append(el("p", null, item.excerpt));
      }

      container.append(article);
    }
  } catch (err) {
    container.replaceChildren(el("p", "muted", "Не удалось загрузить новости."));
  }
}

loadNews();
