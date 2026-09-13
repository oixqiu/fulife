/**
 * 评论组件（纯 JS 动态渲染方案）
 * - 动态加载评论树并渲染，无 SEO 静态化
 * - 支持回复（内联表单）、待审核提示
 * - 所有用户内容经 textContent 输出，防 XSS
 *
 * 使用方式（Hugo 模板 layouts/_partials/comments.html）：
 *   <div id="comment-section" data-post-slug="{{ .RelPermalink }}"></div>
 *   <link rel="stylesheet" href="/css/comments.css">
 *   <script src="/js/comments.js" defer></script>
 */
(function () {
  'use strict';

  // 可通过 window.COMMENT_API 覆盖（如 https://api.yi51.com）
  var API_BASE = window.COMMENT_API || '';
  var MAX_DEPTH = 6; // 渲染最大嵌套层级，超出折叠

  var section = document.getElementById('comment-section');
  if (!section) return;
  var postSlug = section.dataset.postSlug || '';

  function api(path) {
    return API_BASE + path;
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function fmtTime(iso) {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    return t.toLocaleString('zh-CN', { hour12: false });
  }

  function commentItem(node, depth) {
    var item = document.createElement('div');
    item.className = 'comment-item';

    var header = document.createElement('div');
    header.className = 'comment-header';
    var name = document.createElement('strong');
    name.textContent = node.nickname || '匿名';
    var time = document.createElement('time');
    time.textContent = fmtTime(node.created_at);
    header.appendChild(name);
    if (node.website) {
      var site = document.createElement('a');
      site.href = node.website;
      site.rel = 'nofollow noopener';
      site.target = '_blank';
      site.textContent = ' 🔗';
      header.appendChild(site);
    }
    header.appendChild(time);
    item.appendChild(header);

    var body = document.createElement('div');
    body.className = 'comment-body';
    body.textContent = node.content;
    item.appendChild(body);

    // 回复按钮（限制最深一层可回复）
    if (depth < MAX_DEPTH) {
      var replyBtn = document.createElement('button');
      replyBtn.type = 'button';
      replyBtn.className = 'comment-reply-btn';
      replyBtn.textContent = '回复';
      replyBtn.addEventListener('click', function () {
        item.appendChild(replyForm(node.id, item, replyBtn));
        replyBtn.disabled = true;
      });
      item.appendChild(replyBtn);
    }

    // 子评论
    var kids = node.children || [];
    if (kids.length) {
      var childWrap = document.createElement('div');
      childWrap.className = 'comment-children';
      if (depth >= MAX_DEPTH) {
        var fold = document.createElement('button');
        fold.type = 'button';
        fold.className = 'comment-fold-btn';
        fold.textContent = '展开 ' + countAll(kids) + ' 条回复';
        fold.addEventListener('click', function () {
          childWrap.innerHTML = '';
          kids.forEach(function (k) { childWrap.appendChild(commentItem(k, depth + 1)); });
          fold.remove();
        });
        childWrap.appendChild(fold);
      } else {
        kids.forEach(function (k) { childWrap.appendChild(commentItem(k, depth + 1)); });
      }
      item.appendChild(childWrap);
    }
    return item;
  }

  function countAll(nodes) {
    var n = nodes.length;
    nodes.forEach(function (x) { n += countAll(x.children || []); });
    return n;
  }

  function renderTree(tree) {
    var list = document.createElement('div');
    list.className = 'comment-list';
    tree.forEach(function (node) { list.appendChild(commentItem(node, 0)); });

    var old = section.querySelector('.comment-list');
    if (old) old.replaceWith(list); else section.appendChild(list);
  }

  function loadComments() {
    return fetch(api('/api/comments?post_slug=' + encodeURIComponent(postSlug)), {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (res) {
        if (!res.ok) throw new Error('加载评论失败 (' + res.status + ')');
        return res.json();
      })
      .then(renderTree)
      .catch(function (err) {
        console.error(err);
        var tip = document.createElement('div');
        tip.className = 'comment-error';
        tip.textContent = '评论加载失败，请稍后刷新';
        if (!section.querySelector('.comment-error')) section.appendChild(tip);
      });
  }

  function submitForm(parentId) {
    var form = document.createElement('form');
    form.className = 'comment-form';

    var nickname = field('昵称 *', 'text', 50, true);
    var email = field('邮箱（选填）', 'email', 100, false);
    var website = field('网站（选填）', 'url', 100, false);
    var content = document.createElement('textarea');
    content.placeholder = '说点什么… *';
    content.maxLength = 2000;
    content.rows = 4;
    content.required = true;

    var msg = document.createElement('div');
    msg.className = 'comment-form-msg';

    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = '发表评论';

    form.append(nickname, email, website, content, msg, submit);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.textContent = '提交中…';
      msg.className = 'comment-form-msg';
      submit.disabled = true;

      var payload = {
        post_slug: postSlug,
        nickname: nickname.value,
        email: email.value,
        website: website.value,
        content: content.value
      };
      if (parentId) payload.parent_id = parentId;

      fetch(api('/api/comments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) throw new Error(data.error || '提交失败');
            return data;
          });
        })
        .then(function () {
          msg.textContent = '评论已提交，审核通过后显示';
          msg.className = 'comment-form-msg comment-form-ok';
          form.reset();
          // 纯 JS 方案：评论审核通过前列表不显示，无需立即刷新
        })
        .catch(function (err) {
          msg.textContent = err.message || '提交失败，请稍后再试';
          msg.className = 'comment-form-msg comment-form-err';
        })
        .finally(function () { submit.disabled = false; });
    });
    return form;
  }

  function replyForm(parentId, container, replyBtn) {
    var wrap = document.createElement('div');
    wrap.className = 'comment-reply-form';
    wrap.appendChild(submitForm(parentId));
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'comment-cancel-btn';
    cancel.textContent = '取消';
    cancel.addEventListener('click', function () {
      wrap.remove();
      if (replyBtn) replyBtn.disabled = false;
    });
    wrap.appendChild(cancel);
    return wrap;
  }

  function field(labelText, type, maxLen, required) {
    var input = document.createElement('input');
    input.type = type;
    input.maxLength = maxLen;
    input.required = required;
    input.placeholder = labelText;
    return input;
  }

  // 主表单（页面底部）
  var mainForm = submitForm(null);
  mainForm.classList.add('comment-main-form');
  section.appendChild(mainForm);

  loadComments();
})();
