const SAX_WGPU_REQUIRED = false;
const SAX_SA3D_REQUIRED = false;
// airlock.js — SAX 自动生成，请勿手动修改
// WASM ↔ DOM 胶水层（Airlock 气闸舱）

const SAX_AIRLOCK_VERSION = "1.0";

// ── 节点句柄映射表
const _nodeMap = new Map();
const _bindingMap = new Map();
const SAX_DANGEROUS_TAGS = new Set(["script", "iframe", "object", "embed", "template"]);
const SAX_DANGEROUS_ATTRS = new Set(["innerHTML", "outerHTML", "dangerouslySetInnerHTML", "srcDoc"]);
const SAX_URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "cite", "longdesc", "ping", "xlink:href"]);
const SAX_BOOL_PROPS = new Set(["hidden", "inert", "draggable", "controls", "muted", "loop", "autoplay", "playsInline", "disablePictureInPicture", "disableRemotePlayback", "noValidate", "formNoValidate", "disabled", "reversed", "default", "itemScope", "isMap"]);
const SAX_STRING_PROPS = new Set(["value", "min", "max", "step", "low", "high", "optimum", "size", "rows", "cols", "wrap", "width", "height", "start", "span", "placeholder", "pattern", "accept", "capture", "dirName", "label", "maxLength", "minLength", "inputMode", "enterKeyHint", "autoCapitalize", "autocorrect", "contentEditable", "spellcheck", "className", "id", "name", "nonce", "title", "lang", "dir", "role", "accessKey", "tabIndex", "slot", "part", "popover", "itemProp", "itemType", "itemID", "itemRef", "htmlFor", "rowSpan", "colSpan", "headers", "scope", "abbr", "dateTime", "charset", "httpEquiv", "content", "cite", "src", "alt", "coords", "shape", "href", "hreflang", "action", "poster", "download", "ping", "rel", "preload", "media", "integrity", "as", "blocking", "type", "srcset", "sizes", "useMap", "longDesc", "imageSrcset", "imageSizes", "crossOrigin", "controlsList", "loading", "decoding", "fetchPriority", "referrerPolicy", "kind", "srcLang", "autocomplete", "acceptCharset", "enctype", "method", "target", "formAction", "formEnctype", "formMethod", "formTarget"]);
const SAX_SVG_TAGS = new Set([
  "svg", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "g", "defs", "use",
  "symbol", "text", "tspan", "image", "mask", "pattern", "clipPath", "linearGradient", "radialGradient",
  "stop", "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix",
  "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA",
  "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode",
  "feMorphology", "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile",
  "feTurbulence", "foreignObject", "marker", "view",
]);
let _nextHandle = 1;
let _malloc_next = 0;
let _router_path = "";
let _router_listener_installed = false;
let _current_event = null;
let _current_event_target = null;
let _current_event_current_target = null;
function _alloc_handle(el) {
  const h = _nextHandle++;
  _nodeMap.set(h, el);
  return h;
}
function _get_node(h) {
  return _nodeMap.get(Number(h));
}
function _event_target() {
  return _current_event_target ?? _current_event?.target ?? null;
}
function _event_current_target() {
  return _current_event_current_target ?? _current_event?.currentTarget ?? null;
}
function _free_handle(h) {
  _nodeMap.delete(Number(h));
}
function _align_up(value, align) {
  return Math.ceil(value / align) * align;
}
function _heap_base() {
  const base = _wasm_instance && _wasm_instance.exports ? _wasm_instance.exports.__heap_base : null;
  if (base && typeof base.value === "number") return base.value;
  return 1024;
}
function _ensure_mem(bytes) {
  while (_mem.buffer.byteLength < bytes) {
    _mem.grow(1);
  }
}
function _malloc(size) {
  const n = Math.max(1, Number(size));
  if (_malloc_next === 0) _malloc_next = _align_up(_heap_base(), 8);
  const ptr = _malloc_next;
  _malloc_next = _align_up(ptr + n, 8);
  _ensure_mem(_malloc_next);
  return ptr;
}
function _write_u32(ptr, value) {
  new DataView(_mem.buffer).setUint32(Number(ptr), Number(value), true);
}
function _write_u64(ptr, value) {
  new DataView(_mem.buffer).setBigUint64(Number(ptr), BigInt(value), true);
}
function _router_sync_path() {
  if (typeof location === "undefined") return;
  _router_path = `${location.pathname}${location.search}${location.hash}`;
}
function _router_install_listeners() {
  if (_router_listener_installed || typeof window === "undefined") return;
  const sync = () => _router_sync_path();
  window.addEventListener("popstate", sync);
  window.addEventListener("hashchange", sync);
  _router_listener_installed = true;
}
function _http_result(status, body_text) {
  const body_bytes = new TextEncoder().encode(body_text);
  const body_ptr = body_bytes.length === 0 ? 0 : _malloc(body_bytes.length);
  if (body_bytes.length !== 0) {
    new Uint8Array(_mem.buffer, Number(body_ptr), body_bytes.length).set(body_bytes);
  }
  const result_ptr = _malloc(24);
  _write_u32(result_ptr, status >>> 0);
  _write_u64(result_ptr + 8, body_ptr);
  _write_u64(result_ptr + 16, body_bytes.length);
  return BigInt(result_ptr);
}
function _http_request(method, url, body) {
  const xhr = new XMLHttpRequest();
  xhr.open(method, url, false);
  xhr.send(body);
  return _http_result(xhr.status || 0, xhr.responseText || "");
}
function _unbind_handle_events(node_h) {
  const prefix = String(Number(node_h)) + "::";
  for (const [key, binding] of _bindingMap.entries()) {
    if (key.startsWith(prefix)) {
      binding.target.removeEventListener(binding.evt, binding.listener, { capture: binding.capture });
      _bindingMap.delete(key);
    }
  }
}
function _bind_event(node_h, evt, handler, ctx, capture) {
  const el = _get_node(node_h);
  const useCapture = !!capture;
  const isClickAway = evt === "clickaway";
  const targetNode = isClickAway ? document : el;
  const effectiveCapture = isClickAway ? true : useCapture;
  if (!targetNode) return;
  let clickAwayArmed = !isClickAway;
  if (isClickAway) {
    queueMicrotask(() => {
      clickAwayArmed = true;
    });
  }
  const listener = (event) => {
    if (isClickAway && !clickAwayArmed) {
      return;
    }
    const clickAwayHidden = !!(isClickAway && el && ((typeof el.matches === "function" && el.matches("[hidden]")) || (typeof el.closest === "function" && el.closest("[hidden]"))));
    if (clickAwayHidden) {
      return;
    }
    if (isClickAway && el && event?.target && typeof el.contains === "function" && el.contains(event.target)) {
      return;
    }
    if (_wasm_instance && _wasm_instance.exports[handler]) {
      const prev = _current_event;
      const prev_target = _current_event_target;
      const prev_current_target = _current_event_current_target;
      _current_event = event ?? null;
      _current_event_target = event?.target ?? el;
      _current_event_current_target = el;
      try {
        _wasm_instance.exports[handler](ctx);
      } finally {
        _current_event = prev;
        _current_event_target = prev_target;
        _current_event_current_target = prev_current_target;
      }
    }
  };
  const key = `${Number(node_h)}::${evt}::${handler}::${ctx}::${useCapture ? 1 : 0}`;
  const prev = _bindingMap.get(key);
  if (prev) {
    prev.target.removeEventListener(prev.evt, prev.listener, { capture: prev.capture });
  }
  targetNode.addEventListener(isClickAway ? "click" : evt, listener, { capture: effectiveCapture });
  _bindingMap.set(key, { node: el, target: targetNode, evt: isClickAway ? "click" : evt, listener, capture: effectiveCapture });
}
function _has_disallowed_url_value(key, val) {
  if (key === "ping") {
    return String(val).split(/\s+/).filter(Boolean).some((part) => /^javascript:/i.test(part));
  }
  return /^\s*javascript:/i.test(val);
}
function _is_attr_allowed(key, val) {
  if (SAX_DANGEROUS_ATTRS.has(key)) return false;
  if (key.startsWith("on")) return false;
  if (key.includes(":")) return key === "xlink:href";
  if (SAX_URL_ATTRS.has(key) && _has_disallowed_url_value(key, val)) return false;
  return true;
}
function _is_inner_html_allowed(html) {
  return !/<\s*script\b/i.test(html)
    && !/<\s*\/\s*script\s*>/i.test(html)
    && !/\s+on[a-z]+\s*=/i.test(html)
    && !/javascript\s*:/i.test(html);
}

// ── WASM 内存读写工具
let _mem;
function _read_str(ptr, len) {
  return new TextDecoder().decode(
    new Uint8Array(_mem.buffer, Number(ptr), Number(len))
  );
}
function _write_str(ptr, len, str) {
  const bytes = new TextEncoder().encode(str);
  const n = Math.min(bytes.length, Number(len));
  new Uint8Array(_mem.buffer, Number(ptr), n).set(bytes.subarray(0, n));
  return BigInt(n);
}

function _split_select_values(text) {
  return new Set(String(text).split(/[\n,]/).map((item) => item.trim()).filter(Boolean));
}
function _option_value(option) {
  const prop = option?.value;
  if (prop !== undefined && prop !== null && prop !== "") return prop;
  return option?.getAttribute?.("value") ?? option?.textContent ?? "";
}
function _selected_values(node) {
  const options = Array.from(node?.options ?? []).filter((option) => option.selected);
  return options.map(_option_value).join(",");
}
function _node_value(node) {
  return node?.tagName?.toLowerCase?.() === "select" && node.multiple
    ? _selected_values(node)
    : node?.value ?? "";
}

// ── Airlock 白名单 API
export const sax_airlock = {
  malloc(size) {
    return _malloc(size);
  },

  free(_ptr) {
  },

  write(_fd, _ptr, len) {
    return len;
  },

  exit(_code) {
  },

  // DOM 查询
  sax_dom_query(sel_ptr, sel_len) {
    const sel = _read_str(sel_ptr, sel_len);
    const el = document.querySelector(sel);
    return el ? BigInt(_alloc_handle(el)) : -1n;
  },

  sax_dom_query_all(sel_ptr, sel_len, out_ptr, max_count) {
    const sel = _read_str(sel_ptr, sel_len);
    const els = document.querySelectorAll(sel);
    const count = Math.min(els.length, Number(max_count));
    for (let i = 0; i < count; i++) {
      const h = BigInt(_alloc_handle(els[i]));
      new BigInt64Array(_mem.buffer, Number(out_ptr) + i * 8, 1).set([h]);
    }
    return BigInt(count);
  },

  // 节点操作
  sax_dom_create(tag_ptr, tag_len) {
    const tag = _read_str(tag_ptr, tag_len);
    if (SAX_DANGEROUS_TAGS.has(tag)) {
      throw new Error(`SaxUnknownTag: tag '${tag}' is not allowed in SAX`);
    }
    const el = tag === "fragment"
      ? document.createDocumentFragment()
      : SAX_SVG_TAGS.has(tag)
      ? document.createElementNS("http://www.w3.org/2000/svg", tag)
      : document.createElement(tag);
    return BigInt(_alloc_handle(el));
  },

  sax_dom_create_text(text_ptr, text_len) {
    return BigInt(_alloc_handle(document.createTextNode(_read_str(text_ptr, text_len))));
  },

  sax_dom_append_child(parent_h, child_h) {
    _get_node(parent_h).appendChild(_get_node(child_h));
  },

  sax_dom_remove_child(parent_h, child_h) {
    _get_node(parent_h).removeChild(_get_node(child_h));
  },

  sax_dom_remove_self(node_h) {
    _get_node(node_h).remove();
    _unbind_handle_events(node_h);
    _free_handle(node_h);
  },

  sax_dom_insert_before(parent_h, new_h, ref_h) {
    _get_node(parent_h).insertBefore(_get_node(new_h), _get_node(ref_h));
  },

  // 内容操作
  sax_dom_set_text(node_h, text_ptr, text_len) {
    _get_node(node_h).textContent = _read_str(text_ptr, text_len);
  },

  sax_dom_set_inner_html(node_h, html_ptr, html_len) {
    const html = _read_str(html_ptr, html_len);
    if (!_is_inner_html_allowed(html)) {
      throw new Error("SaxInvalidAttribute: dangerous inner HTML is not allowed in SAX");
    }
    _get_node(node_h).innerHTML = html;
  },

  sax_dom_get_text(node_h, buf_ptr, buf_len) {
    return _write_str(buf_ptr, buf_len, _get_node(node_h).textContent ?? "");
  },

  // 属性操作
  sax_dom_set_attr(node_h, key_ptr, key_len, val_ptr, val_len) {
    const key = _read_str(key_ptr, key_len);
    const val = _read_str(val_ptr, val_len);
    if (!_is_attr_allowed(key, val)) {
      throw new Error(`SaxInvalidAttribute: attribute '${key}' is not allowed in SAX`);
    }
    _get_node(node_h).setAttribute(key, val);
  },

  sax_dom_remove_attr(node_h, key_ptr, key_len) {
    const key = _read_str(key_ptr, key_len);
    _get_node(node_h).removeAttribute(key);
  },

  sax_dom_get_attr(node_h, key_ptr, key_len, buf_ptr, buf_len) {
    const key = _read_str(key_ptr, key_len);
    const val = _get_node(node_h).getAttribute(key) ?? "";
    return _write_str(buf_ptr, buf_len, val);
  },

  sax_dom_focus(node_h) {
    const node = _get_node(node_h);
    if (node && typeof node.focus === "function") node.focus();
  },

  // CSS class 操作
  sax_dom_add_class(node_h, cls_ptr, cls_len) {
    const cls = _read_str(cls_ptr, cls_len);
    _get_node(node_h).classList.add(cls);
  },

  sax_dom_remove_class(node_h, cls_ptr, cls_len) {
    const cls = _read_str(cls_ptr, cls_len);
    _get_node(node_h).classList.remove(cls);
  },

  sax_dom_toggle_class(node_h, cls_ptr, cls_len, force) {
    const cls = _read_str(cls_ptr, cls_len);
    return _get_node(node_h).classList.toggle(cls, !!force) ? 1 : 0;
  },

  // 表单值
  sax_dom_get_value(node_h, buf_ptr, buf_len) {
    const node = _get_node(node_h);
    return _write_str(buf_ptr, buf_len, _node_value(node));
  },

  sax_dom_set_value(node_h, val_ptr, val_len) {
    const node = _get_node(node_h);
    const value = _read_str(val_ptr, val_len);
    if (node?.tagName?.toLowerCase?.() === "select" && node.multiple) {
      const values = _split_select_values(value);
      for (const option of Array.from(node.options ?? [])) {
        option.selected = values.has(_option_value(option));
      }
      return;
    }
    node.value = value;
  },

  sax_dom_get_checked(node_h) {
    return _get_node(node_h).checked ? 1 : 0;
  },

  sax_dom_set_checked(node_h, checked) {
    _get_node(node_h).checked = !!checked;
  },

  sax_dom_get_selected(node_h) {
    return _get_node(node_h).selected ? 1 : 0;
  },

  sax_dom_set_selected(node_h, selected) {
    _get_node(node_h).selected = !!selected;
  },

  sax_dom_get_multiple(node_h) {
    return _get_node(node_h).multiple ? 1 : 0;
  },

  sax_dom_set_multiple(node_h, multiple) {
    _get_node(node_h).multiple = !!multiple;
  },

  sax_dom_get_disabled(node_h) {
    return _get_node(node_h).disabled ? 1 : 0;
  },

  sax_dom_set_disabled(node_h, disabled) {
    _get_node(node_h).disabled = !!disabled;
  },

  sax_dom_get_readonly(node_h) {
    return _get_node(node_h).readOnly ? 1 : 0;
  },

  sax_dom_set_readonly(node_h, readonly) {
    _get_node(node_h).readOnly = !!readonly;
  },

  sax_dom_get_required(node_h) {
    return _get_node(node_h).required ? 1 : 0;
  },

  sax_dom_set_required(node_h, required) {
    _get_node(node_h).required = !!required;
  },

  sax_dom_get_open(node_h) {
    return _get_node(node_h).open ? 1 : 0;
  },

  sax_dom_set_open(node_h, open) {
    _get_node(node_h).open = !!open;
  },

  sax_dom_set_translate(node_h, val_ptr, val_len) {
    const raw = _read_str(val_ptr, val_len);
    const normalized = raw.trim().toLowerCase();
    const enabled = !(normalized === "no" || normalized === "false" || normalized === "0");
    const attr = enabled ? "yes" : "no";
    const node = _get_node(node_h);
    node.translate = enabled;
    if (!_is_attr_allowed("translate", attr)) {
      throw new Error("SaxInvalidAttribute: attribute 'translate' is not allowed in SAX");
    }
    node.setAttribute("translate", attr);
  },

  sax_dom_get_bool_prop(node_h, prop_ptr, prop_len) {
    const prop = _read_str(prop_ptr, prop_len);
    if (!SAX_BOOL_PROPS.has(prop)) return 0;
    return _get_node(node_h)[prop] ? 1 : 0;
  },

  sax_dom_set_bool_prop(node_h, prop_ptr, prop_len, value) {
    const prop = _read_str(prop_ptr, prop_len);
    if (!SAX_BOOL_PROPS.has(prop)) {
      throw new Error(`SaxInvalidAttribute: bool property '${prop}' is not allowed in SAX`);
    }
    _get_node(node_h)[prop] = !!value;
  },

  sax_dom_get_str_prop(node_h, prop_ptr, prop_len, buf_ptr, buf_len) {
    const prop = _read_str(prop_ptr, prop_len);
    if (!SAX_STRING_PROPS.has(prop)) return 0n;
    return _write_str(buf_ptr, buf_len, _get_node(node_h)[prop] ?? "");
  },

  sax_dom_set_str_prop(node_h, prop_ptr, prop_len, val_ptr, val_len) {
    const prop = _read_str(prop_ptr, prop_len);
    const val = _read_str(val_ptr, val_len);
    if (!SAX_STRING_PROPS.has(prop)) {
      throw new Error(`SaxInvalidAttribute: string property '${prop}' is not allowed in SAX`);
    }
    const node = _get_node(node_h);
    const attr = prop === "maxLength" ? "maxlength"
      : prop === "minLength" ? "minlength"
      : prop === "dirName" ? "dirname"
      : prop === "tabIndex" ? "tabindex"
      : prop === "inputMode" ? "inputmode"
      : prop === "enterKeyHint" ? "enterkeyhint"
      : prop === "autoCapitalize" ? "autocapitalize"
      : prop === "contentEditable" ? "contenteditable"
      : prop === "className" ? "class"
      : prop === "accessKey" ? "accesskey"
      : prop === "itemProp" ? "itemprop"
      : prop === "itemType" ? "itemtype"
      : prop === "itemID" ? "itemid"
      : prop === "itemRef" ? "itemref"
      : prop === "htmlFor" ? "for"
      : prop === "rowSpan" ? "rowspan"
      : prop === "colSpan" ? "colspan"
      : prop === "dateTime" ? "datetime"
      : prop === "httpEquiv" ? "http-equiv"
      : prop === "useMap" ? "usemap"
      : prop === "longDesc" ? "longdesc"
      : prop === "imageSrcset" ? "imagesrcset"
      : prop === "imageSizes" ? "imagesizes"
      : prop === "crossOrigin" ? "crossorigin"
      : prop === "controlsList" ? "controlslist"
      : prop === "fetchPriority" ? "fetchpriority"
      : prop === "referrerPolicy" ? "referrerpolicy"
      : prop === "srcLang" ? "srclang"
      : prop === "acceptCharset" ? "accept-charset"
      : prop === "formAction" ? "formaction"
      : prop === "formEnctype" ? "formenctype"
      : prop === "formMethod" ? "formmethod"
      : prop === "formTarget" ? "formtarget"
      : prop;
    if (!_is_attr_allowed(attr, val)) {
      throw new Error(`SaxInvalidAttribute: attribute '${attr}' is not allowed in SAX`);
    }
    if (prop === "className") {
      if (typeof SVGElement !== "undefined" && node instanceof SVGElement) {
        node.setAttribute("class", val);
        return;
      }
      node.className = val;
    } else {
      node[prop] = prop === "spellcheck" ? val !== "false" : val;
    }
    node.setAttribute(attr, val);
  },

  sax_event_target() {
    const target = _event_target();
    return target ? BigInt(_alloc_handle(target)) : 0n;
  },

  sax_event_target_value(buf_ptr, buf_len) {
    const target = _event_target();
    return _write_str(buf_ptr, buf_len, _node_value(target));
  },

  sax_event_target_checked() {
    const target = _event_target();
    return target?.checked ? 1 : 0;
  },

  sax_event_target_name(buf_ptr, buf_len) {
    const target = _event_target();
    return _write_str(buf_ptr, buf_len, target?.name ?? "");
  },

  sax_event_target_id(buf_ptr, buf_len) {
    const target = _event_target();
    return _write_str(buf_ptr, buf_len, target?.id ?? "");
  },

  sax_event_key(buf_ptr, buf_len) {
    return _write_str(buf_ptr, buf_len, _current_event?.key ?? "");
  },

  sax_event_code(buf_ptr, buf_len) {
    return _write_str(buf_ptr, buf_len, _current_event?.code ?? "");
  },

  sax_event_repeat() {
    return _current_event?.repeat ? 1 : 0;
  },

  sax_event_type(buf_ptr, buf_len) {
    return _write_str(buf_ptr, buf_len, _current_event?.type ?? "");
  },

  sax_event_data(buf_ptr, buf_len) {
    return _write_str(buf_ptr, buf_len, _current_event?.data ?? "");
  },

  sax_event_input_type(buf_ptr, buf_len) {
    return _write_str(buf_ptr, buf_len, _current_event?.inputType ?? "");
  },

  sax_event_time_stamp() {
    return BigInt(Math.trunc(Number(_current_event?.timeStamp ?? 0)));
  },

  sax_event_current_target() {
    const target = _event_current_target();
    return target ? BigInt(_alloc_handle(target)) : 0n;
  },

  sax_event_current_target_value(buf_ptr, buf_len) {
    const target = _event_current_target();
    return _write_str(buf_ptr, buf_len, _node_value(target));
  },

  sax_event_current_target_checked() {
    const target = _event_current_target();
    return target?.checked ? 1 : 0;
  },

  sax_event_current_target_name(buf_ptr, buf_len) {
    const target = _event_current_target();
    return _write_str(buf_ptr, buf_len, target?.name ?? "");
  },

  sax_event_current_target_id(buf_ptr, buf_len) {
    const target = _event_current_target();
    return _write_str(buf_ptr, buf_len, target?.id ?? "");
  },

  sax_event_related_target() {
    const target = _current_event?.relatedTarget ?? null;
    return target ? BigInt(_alloc_handle(target)) : 0n;
  },

  sax_event_related_target_name(buf_ptr, buf_len) {
    const target = _current_event?.relatedTarget ?? null;
    return _write_str(buf_ptr, buf_len, target?.name ?? "");
  },

  sax_event_related_target_id(buf_ptr, buf_len) {
    const target = _current_event?.relatedTarget ?? null;
    return _write_str(buf_ptr, buf_len, target?.id ?? "");
  },

  sax_event_default_prevented() {
    return _current_event?.defaultPrevented ? 1 : 0;
  },

  sax_event_button() {
    return BigInt(Number(_current_event?.button ?? 0));
  },

  sax_event_client_x() {
    return BigInt(Number(_current_event?.clientX ?? 0));
  },

  sax_event_client_y() {
    return BigInt(Number(_current_event?.clientY ?? 0));
  },

  sax_event_page_x() {
    return BigInt(Number(_current_event?.pageX ?? 0));
  },

  sax_event_page_y() {
    return BigInt(Number(_current_event?.pageY ?? 0));
  },

  sax_event_screen_x() {
    return BigInt(Number(_current_event?.screenX ?? 0));
  },

  sax_event_screen_y() {
    return BigInt(Number(_current_event?.screenY ?? 0));
  },

  sax_event_pointer_id() {
    return BigInt(Number(_current_event?.pointerId ?? 0));
  },

  sax_event_pointer_type(buf_ptr, buf_len) {
    return _write_str(buf_ptr, buf_len, _current_event?.pointerType ?? "");
  },

  sax_event_is_primary() {
    return _current_event?.isPrimary ? 1 : 0;
  },

  sax_event_delta_x() {
    return BigInt(Number(_current_event?.deltaX ?? 0));
  },

  sax_event_delta_y() {
    return BigInt(Number(_current_event?.deltaY ?? 0));
  },

  sax_event_delta_z() {
    return BigInt(Number(_current_event?.deltaZ ?? 0));
  },

  sax_event_delta_mode() {
    return BigInt(Number(_current_event?.deltaMode ?? 0));
  },

  sax_event_touches_len() {
    return BigInt(Number(_current_event?.touches?.length ?? 0));
  },

  sax_event_touch_identifier() {
    const touch = _current_event?.touches?.[0] ?? null;
    return BigInt(Number(touch?.identifier ?? 0));
  },

  sax_event_touch_client_x() {
    const touch = _current_event?.touches?.[0] ?? null;
    return BigInt(Number(touch?.clientX ?? 0));
  },

  sax_event_touch_client_y() {
    const touch = _current_event?.touches?.[0] ?? null;
    return BigInt(Number(touch?.clientY ?? 0));
  },

  sax_event_clipboard_text(buf_ptr, buf_len) {
    const data = _current_event?.clipboardData ?? null;
    const text = data && typeof data.getData === "function" ? data.getData("text") : "";
    return _write_str(buf_ptr, buf_len, text ?? "");
  },

  sax_event_data_transfer_text(buf_ptr, buf_len) {
    const data = _current_event?.dataTransfer ?? null;
    const text = data && typeof data.getData === "function" ? data.getData("text") : "";
    return _write_str(buf_ptr, buf_len, text ?? "");
  },

  sax_event_shift_key() {
    return _current_event?.shiftKey ? 1 : 0;
  },

  sax_event_ctrl_key() {
    return _current_event?.ctrlKey ? 1 : 0;
  },

  sax_event_alt_key() {
    return _current_event?.altKey ? 1 : 0;
  },

  sax_event_meta_key() {
    return _current_event?.metaKey ? 1 : 0;
  },

  sax_event_prevent_default() {
    if (_current_event && typeof _current_event.preventDefault === "function") {
      _current_event.preventDefault();
    } else if (_current_event) {
      _current_event.defaultPrevented = true;
    }
  },

  sax_event_stop_propagation() {
    if (_current_event && typeof _current_event.stopPropagation === "function") {
      _current_event.stopPropagation();
    } else if (_current_event) {
      _current_event.cancelBubble = true;
    }
  },

  // 事件系统
  sax_dom_bind_event(node_h, evt_ptr, evt_len, handler_ptr, handler_len, ctx) {
    const evt = _read_str(evt_ptr, evt_len);
    const handler = _read_str(handler_ptr, handler_len);
    _bind_event(node_h, evt, handler, ctx, false);
  },

  sax_dom_bind_event_capture(node_h, evt_ptr, evt_len, handler_ptr, handler_len, ctx) {
    const evt = _read_str(evt_ptr, evt_len);
    const handler = _read_str(handler_ptr, handler_len);
    _bind_event(node_h, evt, handler, ctx, true);
  },

  sax_dom_unbind_event(node_h, evt_ptr, evt_len, handler_ptr, handler_len, ctx) {
    const evt = _read_str(evt_ptr, evt_len);
    const handler = _read_str(handler_ptr, handler_len);
    const key = `${Number(node_h)}::${evt}::${handler}::${ctx}::0`;
    const binding = _bindingMap.get(key);
    if (binding) {
      binding.target.removeEventListener(binding.evt, binding.listener, { capture: binding.capture });
      _bindingMap.delete(key);
    }
  },

  sax_set_timeout(handler_ptr, handler_len, delay_ms) {
    const handler = _read_str(handler_ptr, handler_len);
    return BigInt(setTimeout(() => {
      if (_wasm_instance && _wasm_instance.exports[handler]) {
        _wasm_instance.exports[handler](0n);
      }
    }, Number(delay_ms)));
  },

  sax_set_interval(handler_ptr, handler_len, delay_ms) {
    const handler = _read_str(handler_ptr, handler_len);
    return BigInt(setInterval(() => {
      if (_wasm_instance && _wasm_instance.exports[handler]) {
        _wasm_instance.exports[handler](0n);
      }
    }, Number(delay_ms)));
  },

  sax_clear_timeout(id) {
    clearTimeout(Number(id));
  },

  sax_clear_interval(id) {
    clearInterval(Number(id));
  },

  sax_router_init(path_ptr, path_len) {
    _router_sync_path();
    _router_install_listeners();
    return _write_str(path_ptr, path_len, _router_path);
  },

  // 路由
  sax_router_get_path(buf_ptr, buf_len) {
    _router_sync_path();
    return _write_str(buf_ptr, buf_len, _router_path);
  },

  sax_router_push(path_ptr, path_len) {
    const path = _read_str(path_ptr, path_len);
    _router_path = path;
    if (typeof history !== "undefined" && history.pushState) {
      history.pushState({}, "", path);
    } else if (typeof location !== "undefined") {
      location.hash = path;
    }
  },

  sax_router_replace(path_ptr, path_len) {
    const path = _read_str(path_ptr, path_len);
    _router_path = path;
    if (typeof history !== "undefined" && history.replaceState) {
      history.replaceState({}, "", path);
    } else if (typeof location !== "undefined") {
      location.hash = path;
    }
  },

  // HTTP
  sax_http_get(url_ptr, url_len) {
    const url = _read_str(url_ptr, url_len);
    return _http_request("GET", url, null);
  },

  sax_http_post(url_ptr, url_len, body_ptr, body_len) {
    const url = _read_str(url_ptr, url_len);
    const body = _read_str(body_ptr, body_len);
    return _http_request("POST", url, body);
  },

  // 工具函数
  sax_get_time() {
    return BigInt(Date.now());
  },

  sax_itoa(value, buf_ptr, buf_len) {
    return _write_str(buf_ptr, buf_len, value.toString());
  },

  sax_ftoa(value, decimals, buf_ptr, buf_len) {
    return _write_str(buf_ptr, buf_len, value.toFixed(Number(decimals)));
  },

  sax_ftoa_bits(value_bits, decimals, buf_ptr, buf_len) {
    const scratch = new ArrayBuffer(8);
    const view = new DataView(scratch);
    view.setBigInt64(0, BigInt(value_bits), true);
    const value = view.getFloat64(0, true);
    return _write_str(buf_ptr, buf_len, value.toFixed(Number(decimals)));
  },

  sax_json_write_string(src_ptr, src_len, dst_ptr, dst_len) {
    return _write_str(dst_ptr, dst_len, JSON.stringify(_read_str(src_ptr, src_len)));
  },

  sax_json_write_object_members(src_ptr, src_len, dst_ptr, dst_len, prefix_comma) {
    let parsed;
    try {
      parsed = JSON.parse(_read_str(src_ptr, src_len));
    } catch (_err) {
      return BigInt(0);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return BigInt(0);
    const members = Object.entries(parsed).map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`).join(",");
    if (members.length === 0) return BigInt(0);
    return _write_str(dst_ptr, dst_len, prefix_comma ? `,${members}` : members);
  },

  sax_json_normalize_object(src_ptr, src_len, dst_ptr, dst_len) {
    let parsed;
    try {
      parsed = JSON.parse(_read_str(src_ptr, src_len));
    } catch (_err) {
      return BigInt(0);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return BigInt(0);
    return _write_str(dst_ptr, dst_len, JSON.stringify(parsed));
  },

  sax_mem_copy(dst_ptr, src_ptr, len) {
    const dst = new Uint8Array(_mem.buffer, Number(dst_ptr), Number(len));
    const src = new Uint8Array(_mem.buffer, Number(src_ptr), Number(len));
    dst.set(src);
  },

  sax_mem_eq(lhs_ptr, rhs_ptr, len) {
    const lhs = new Uint8Array(_mem.buffer, Number(lhs_ptr), Number(len));
    const rhs = new Uint8Array(_mem.buffer, Number(rhs_ptr), Number(len));
    for (let i = 0; i < lhs.length; i += 1) {
      if (lhs[i] !== rhs[i]) return 0;
    }
    return 1;
  },
};

export function sax_debug_get_memory() {
  return _mem;
}

export function sax_debug_get_node(h) {
  return _get_node(h);
}
async function _load_wgpu_airlock() {
  return null;
}
async function _load_sa3d_airlock() {
  return null;
}
// ── WASM 加载入口
let _wasm_instance;
export async function sax_init(wasm_url) {
  const wgpu_module = await _load_wgpu_airlock();
  const sa3d_module = await _load_sa3d_airlock();
  const imports = { ...sax_airlock };
  if (wgpu_module) Object.assign(imports, wgpu_module.sax_wgpu_airlock);
  if (sa3d_module) Object.assign(imports, sa3d_module.sax_sa3d_airlock);
  const { instance } = await WebAssembly.instantiateStreaming(
    fetch(wasm_url),
    { env: imports }
  );
  _wasm_instance = instance;
  _mem = instance.exports.memory;
  if (wgpu_module) wgpu_module.sax_wgpu_bind_wasm(instance, _mem);
  if (sa3d_module) sa3d_module.sax_sa3d_bind_wasm(instance, _mem);
  _malloc_next = _align_up(_heap_base(), 8);
  _router_sync_path();
  _router_install_listeners();
  if (instance.exports.sax_app_init) {
    instance.exports.sax_app_init();
  }
}

let _sax_boot_started = false;
function _sax_boot() {
  if (_sax_boot_started) return;
  _sax_boot_started = true;
  sax_init("./app.wasm").catch((err) => console.error(err));
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.sax_debug_get_node = sax_debug_get_node;
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", _sax_boot, { once: true });
  } else {
    _sax_boot();
  }
}