import re
ANC='current-menu-ancestor current-menu-parent current_page_parent current_page_ancestor '

def apply_active(html, menu_item=None, page_item=None, ancestor=None):
    """Reproduce WordPress's active-state classes on the neutral header template."""
    def edit_class(tag, want_id, insert):
        m=re.search(r'\sclass="([^"]*)"', tag)
        if not m: return tag
        cls=m.group(1)
        if not re.search(r'\bmenu-item-%s\b'%want_id, cls): return tag
        # WordPress emits the current-* markers before menu-item-has-children
        anchor='menu-item-has-children' if 'menu-item-has-children' in cls else 'menu-item-%s'%want_id
        newcls=cls.replace(anchor, insert+anchor, 1)
        return tag[:m.start(1)] + newcls + tag[m.end(1):]

    out=html
    if ancestor:
        out=re.sub(r'<li[^>]*>', lambda m: edit_class(m.group(0), ancestor, ANC), out)
    if menu_item:
        MARK='current-menu-item page_item page-item-%s current_page_item '%page_item
        out=re.sub(r'<li[^>]*>', lambda m: edit_class(m.group(0), menu_item, MARK), out)
        def a_fix(m):
            li=m.group(0)
            if 'current-menu-item' not in li: return li
            li=re.sub(r'(<a\s+href="[^"]*")', r'\1 aria-current="page"', li, count=1)
            li=re.sub(r'(<a[^>]*\sclass="[^"]*?)"', r'\1 active"', li, count=1)
            return li
        out=re.sub(r'<li[^>]*>\s*<a[^>]*>.*?</a>', a_fix, out, flags=re.S)
    return out
