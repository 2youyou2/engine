'use strict';
exports.template = `
<section></section>
`;
exports.$ = {
    section: 'section',
};
exports.style = `
    .tab-group {
        margin-top: 10px;
        margin-bottom: 10px;
    }
    .tab-content {
        display: none;
        border: 1px dashed var(--color-normal-border);
        padding: 10px;
        margin-top: -9px;
        border-top-right-radius: calc(var(--size-normal-radius) * 1px);
        border-bottom-left-radius: calc(var(--size-normal-radius) * 1px);
        border-bottom-right-radius: calc(var(--size-normal-radius) * 1px);
    }
`;

// 统一兼容字符串和对象两种 group 写法，后续分组容器构建都走同一套结构。
function normalizeGroupInfo(group) {
    if (!group) {
        return null;
    }

    if (typeof group !== 'object') {
        return {
            id: group || 'default',
            name: group || 'default',
        };
    }

    const normalized = Object.assign({}, group);
    normalized.id = normalized.id || normalized.name || 'default';
    normalized.name = normalized.name || normalized.id;
    return normalized;
}

exports.methods = {
    createTabGroup(dump) {
        const $group = document.createElement('div');
        $group.setAttribute('class', 'tab-group');
        $group.dump = dump;
        $group.tabs = {};
        $group.displayOrder = dump.displayOrder;

        $group.$header = document.createElement('ui-tab');
        $group.$header.setAttribute('class', 'tab-header');
        $group.appendChild($group.$header);
        $group.$header.addEventListener('change', (e) => {
            active(e.target.value);
        });

        function active(index) {
            const tabNames = Object.keys($group.tabs);
            const tabName = tabNames[index];
            $group.childNodes.forEach((child) => {
                if (!child.classList.contains('tab-content')) {
                    return;
                }
                if (child.getAttribute('name') === tabName) {
                    child.style.display = 'block';
                } else {
                    child.style.display = 'none';
                }
            });
        }

        setTimeout(() => {
            active(0);
        });
        return $group;
    },
    // section 风格的 group 需要一个可折叠容器来承载同组属性。
    createGroup(dump) {
        const $group = document.createElement('div');
        $group.setAttribute('class', 'ui-prop-group');
        $group.dump = dump;
        $group.names = {};
        $group.displayOrder = dump.displayOrder;
        return $group;
    },
    toggleGroups($groups) {
        for (const key in $groups) {
            const $group = $groups[key];
            if (!$group) {
                continue;
            }

            // section 分组按子容器逐个判断显隐，保证整组折叠标题只在组内有可见属性时显示。
            if ($group.dump && $group.dump.style === 'section') {
                const $contents = $group.querySelectorAll('.ui-prop-group-content');
                let groupShow = false;
                $contents.forEach(($content) => {
                    const $props = Array.from($content.querySelectorAll(':scope > ui-prop'));
                    const show = $props.some(($prop) => getComputedStyle($prop).display !== 'none');
                    if (show) {
                        $content.removeAttribute('hidden');
                        groupShow = true;
                    } else {
                        $content.setAttribute('hidden', '');
                    }
                });
                if (groupShow) {
                    $group.removeAttribute('hidden');
                } else {
                    $group.setAttribute('hidden', '');
                }
                continue;
            }

            const $props = Array.from($group.querySelectorAll('.tab-content > ui-prop'));
            const show = $props.some(($prop) => getComputedStyle($prop).display !== 'none');
            if (show) {
                $group.removeAttribute('hidden');
            } else {
                $group.setAttribute('hidden', '');
            }
        }
    },
    // 为 section group 创建带缓存键的折叠面板，保持展开状态与 Creator 现有行为一致。
    appendToGroup($group, name) {
        if ($group.names[name]) {
            return;
        }

        const $content = document.createElement('ui-section');
        $content.setAttribute('class', 'ui-prop-group-content');
        $content.setAttribute('expand', '');

        let parentCacheKey = 'ui-prop-group-content';
        let $parent = $group;
        while ($parent) {
            if ($parent.hasAttribute && $parent.hasAttribute('cache-expand')) {
                parentCacheKey = $parent.getAttribute('cache-expand');
                break;
            }
            $parent = $parent.parentElement;
        }
        $content.setAttribute('cache-expand', `${parentCacheKey}-${name}`);

        const $header = document.createElement('ui-label');
        $header.setAttribute('slot', 'header');
        $header.value = this.getName(name);
        $content.appendChild($header);

        $group.appendChild($content);
        $group.names[name] = $content;
    },
    appendToTabGroup($group, tabName) {
        if ($group.tabs[tabName]) {
            return;
        }
        const $content = document.createElement('div');
        $group.tabs[tabName] = $content;
        $content.setAttribute('class', 'tab-content');
        $content.setAttribute('name', tabName);
        $group.appendChild($content);

        const $label = document.createElement('ui-label');
        $label.value = this.getName(tabName);

        const $button = document.createElement('ui-button');
        $button.setAttribute('name', tabName);
        $button.appendChild($label);
        $group.$header.appendChild($button);
    },
    appendChildByDisplayOrder(parent, newChild) {
        const displayOrder = newChild.displayOrder || 0;
        const children = Array.from(parent.children);
        const child = children.find((child) => child.dump && child.displayOrder > displayOrder);
        if (child) {
            child.before(newChild);
        } else {
            parent.appendChild(newChild);
        }
    },
    getName(name) {
        name = name.trim().replace(/^\S/, (str) => str.toUpperCase());
        name = name.replace(/_/g, ' ');
        name = name.replace(/ \S/g, (str) => ` ${str.toUpperCase()}`);
        name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
        return name.trim();
    },
};

// 按 group 定义创建或复用容器，并把 group 自身也插回统一的显示顺序中。
function ensureGroup($panel, $section, dump, groupInfo) {
    if (!dump.groups) {
        return null;
    }

    const groupDump = dump.groups[groupInfo.id];
    if (!groupDump) {
        return null;
    }

    const style = groupDump.style || groupInfo.style || 'section';
    const currentGroup = $panel.$groups[groupInfo.id];
    const isInvalidGroup = !currentGroup
        || (style === 'tab' && !currentGroup.tabs)
        || (style === 'section' && !currentGroup.names);

    if (isInvalidGroup) {
        if (currentGroup instanceof HTMLElement) {
            currentGroup.remove();
        }

        if (style === 'tab') {
            $panel.$groups[groupInfo.id] = $panel.createTabGroup(groupDump);
        } else if (style === 'section') {
            $panel.$groups[groupInfo.id] = $panel.createGroup(groupDump);
        }
    }

    const $group = $panel.$groups[groupInfo.id];
    if (!$group) {
        return null;
    }

    if (!$group.isConnected) {
        $panel.appendChildByDisplayOrder($section, $group);
    }

    if (style === 'tab') {
        $panel.appendToTabGroup($group, groupInfo.name);
        return {
            style,
            container: $group.tabs[groupInfo.name],
        };
    }

    if (style === 'section') {
        $panel.appendToGroup($group, groupInfo.name);
        return {
            style,
            container: $group.names[groupInfo.name],
        };
    }

    return null;
}

// group 优先：属性只要归属于某个 group，就优先放进对应分组容器，而不是直接挂到根面板。
function appendPropToParent($panel, $section, dump, info, $prop) {
    const groupInfo = normalizeGroupInfo(info.group);
    if (groupInfo && dump.groups) {
        const result = ensureGroup($panel, $section, dump, groupInfo);
        if (result && result.container) {
            $panel.appendChildByDisplayOrder(result.container, $prop);
            return;
        }
    }

    $panel.appendChildByDisplayOrder($section, $prop);
}

async function update(dump) {
    const $panel = this;

    if (!$panel.$this.isConnected) {
        return;
    }

    const $section = $panel.$.section;
    const oldPropList = Object.keys($panel.$propList);
    const newPropList = [];

    Object.keys(dump.value).forEach((key, index) => {
        const info = dump.value[key];
        if (!info.visible) {
            return;
        }

        if (dump.values) {
            info.values = dump.values.map((value) => {
                return value[key].value;
            });
        }
        const id = `${info.type || info.name}:${info.path}`;
        newPropList.push(id);
        let $prop = $panel.$propList[id];
        if (!$prop) {
            $prop = document.createElement('ui-prop');
            $prop.setAttribute('type', 'dump');
            $panel.$propList[id] = $prop;

            // 属性自身的顺序仍然只看 property order，group 的排序由外层容器单独处理。
            $prop.displayOrder = info.displayOrder === undefined ? index : Number(info.displayOrder);
            appendPropToParent($panel, $section, dump, info, $prop);
        } else if (!$prop.isConnected || !$prop.parentElement) {
            appendPropToParent($panel, $section, dump, info, $prop);
        }
        $prop.render(info);
    });

    for (const id of oldPropList) {
        if (!newPropList.includes(id)) {
            const $prop = $panel.$propList[id];
            if ($prop && $prop.parentElement) {
                $prop.parentElement.removeChild($prop);
            }
        }
    }

    $panel.toggleGroups($panel.$groups);
}
exports.update = update;

async function ready() {
    const $panel = this;
    $panel.$propList = {};
    $panel.$groups = {};
}
exports.ready = ready;

async function close() {
    const $panel = this;
    for (const key in $panel.$groups) {
        $panel.$groups[key].remove();
    }

    $panel.$groups = {};
}
exports.close = close;
