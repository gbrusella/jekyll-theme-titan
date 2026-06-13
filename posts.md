---
layout: default
title: Posts
permalink: /posts/
---
<div class="panel">
  <h1>Posts</h1>
  <ul class="post-list">
    {% for post in site.posts %}
    <li>
      <a href="{{ post.url | relative_url }}">{{ post.title }}</a>
      <div class="post-meta">{{ post.date | date: '%b %-d, %Y' }}</div>
    </li>
    {% endfor %}
  </ul>
</div>
