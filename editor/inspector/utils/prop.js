/* eslint-disable @typescript-eslint/no-unsafe-return */
/*
 * Returns the ordered PropMap
 * @param {*} value of dump
 * @returns {key:string dump:object}[]
 */
exports.sortProp = function(propMap) {
    const orderList = [];
    const normalList = [];

    Object.keys(propMap).forEach((key) => {
        const item = propMap[key];
        if (item != null) {
            if ('displayOrder' in item) {
                orderList.push({
                    key,
                    dump: item,
                });
            } else {
                normalList.push({
                    key,
                    dump: item,
                });
            }
        }
    });

    orderList.sort((a, b) => a.dump.displayOrder - b.dump.displayOrder);

    return orderList.concat(normalList);
};

/**
 *
 * This method is used to update the custom node
 * @param {HTMLElement} container
 * @param {string[]} excludeList
 * @param {object} dump
 * @param {(element,prop)=>void} update
 */
exports.updateCustomPropElements = function(container, excludeList, dump, update) {
    const sortedProp = exports.sortProp(dump.value);
    container.$ = container.$ || {};
    /**
     * @type {Array<HTMLElement>}
     */
    const children = [];
    sortedProp.forEach((prop) => {
        if (!excludeList.includes(prop.key)) {
            if (!prop.dump.visible) {
                return;
            }
            let node = container.$[prop.key];
            if (!node) {
                node = document.createElement('ui-prop');
                node.setAttribute('type', 'dump');
                node.dump = prop.dump;
                node.key = prop.key;
                container.$[prop.key] = node;
            }

            if (typeof update === 'function') {
                update(node, prop);
            }

            children.push(node);
        }
    });
    const currentChildren = Array.from(container.children);
    children.forEach((child, i) => {
        if (child === currentChildren[i]) {
            return;
        }

        container.appendChild(child);
    });

    // delete extra children
    currentChildren.forEach(($child) => {
        if (!children.includes($child)) {
            $child.remove();
        }
    });
};

/**
 * Tool function: recursively set readonly in resource data
 */
exports.loopSetAssetDumpDataReadonly = function(dump) {
    if (typeof dump !== 'object') {
        return;
    }

    if (dump.readonly === undefined) {
        return;
    }

    dump.readonly = true;

    if (dump.isArray) {
        for (let i = 0; i < dump.value.length; i++) {
            exports.loopSetAssetDumpDataReadonly(dump.value[i]);
        }
        return;
    }

    for (const key in dump.value) {
        exports.loopSetAssetDumpDataReadonly(dump.value[key]);
    }
};

/**
 * Tool functions: set to unavailable
 * @param {object} data  dump | function
 * @param element
 */
exports.setDisabled = function(data, element) {
    if (!element) {
        return;
    }

    let disabled = data;

    if (typeof data === 'function') {
        disabled = data();
    }

    if (disabled === true) {
        element.setAttribute('disabled', 'true');
    } else {
        element.removeAttribute('disabled');
    }
};

/**
 * Tool function: Set read-only status
 * @param {object} data  dump | function
 * @param element
 */
exports.setReadonly = function(data, element) {
    if (!element) {
        return;
    }

    let readonly = data;

    if (typeof data === 'function') {
        readonly = data();
    }

    if (readonly === true) {
        element.setAttribute('readonly', 'true');
    } else {
        element.removeAttribute('readonly');
    }

    if (element.render && element.dump) {
        element.dump.readonly = readonly;
        element.render();
    }
};

/**
 * Tool function: Set the display status
 * @param {Function | boolean} data  dump | function
 * @param {HTMLElement} element
 */
exports.setHidden = function(data, element) {
    if (!element) {
        return;
    }

    let hidden = data;

    if (typeof data === 'function') {
        hidden = data();
    }

    if (hidden === true) {
        element.setAttribute('hidden', '');
    } else {
        element.removeAttribute('hidden');
    }
};

exports.updatePropByDump = function(panel, dump) {
    panel.dump = dump;

    if (!panel.elements) {
        panel.elements = {};
    }

    if (!panel.$props) {
        panel.$props = {};
    }

    if (!panel.$groups) {
        panel.$groups = {};
    }

    const oldPropKeys = Object.keys(panel.$props);
    const newPropKeys = [];

    Object.keys(dump.value).forEach((key, index) => {
        const info = dump.value[key];
        if (!info.visible) {
            return;
        }

        const element = panel.elements[key];
        let $prop = panel.$props[key];

        newPropKeys.push(key);

        if (!$prop) {
            if (element && element.create) {
                // when it need to go custom initialize
                $prop = panel.$props[key] = panel.$[key] = element.create.call(panel, info);
            } else {
                $prop = panel.$props[key] = panel.$[key] = document.createElement('ui-prop');
                $prop.setAttribute('type', 'dump');
            }

            // 属性本身只按 property order 排序，避免把 group order 混进单个属性的 displayOrder。
            $prop.displayOrder = info.displayOrder === undefined ? index : Number(info.displayOrder);

            if (element && element.displayOrder !== undefined) {
                $prop.displayOrder = element.displayOrder;
            }

            if (!element || !element.isAppendToParent || element.isAppendToParent.call(panel)) {
                if (info.group && dump.groups) {
                    const { id = 'default', name } = info.group;
                    // 同一个 group 可能先前按另一种样式创建过，这里按最新定义校正容器类型。
                    if (dump.groups[id]) {
                        // 已经存在于 DOM 的旧容器如果样式不匹配，需要先移除再按新的 group 风格重建。
                        const groupStyle = dump.groups[id].style;
                        const currentGroup = panel.$groups[id];
                        const isInvalidGroup = !currentGroup
                            || (groupStyle === 'tab' && !currentGroup.tabs)
                            || (groupStyle === 'section' && !currentGroup.names);
                        if (isInvalidGroup) {
                            if (currentGroup instanceof HTMLElement) {
                                currentGroup.remove();
                            }
                            if (groupStyle === 'tab') {
                                panel.$groups[id] = exports.createTabGroup(dump.groups[id], panel);
                            } else if (groupStyle === 'section') {
                                panel.$groups[id] = exports.createGroup(dump.groups[id]);
                            }
                        }
                    }

                    if (panel.$groups[id]) {
                        // 组本身没有有限 order 时，用子属性的最小顺序把组插回正确位置。
                        exports.syncGroupDisplayOrder(panel.$.componentContainer, panel.$groups[id], dump.groups[id], $prop.displayOrder);
                        if (!panel.$groups[id].isConnected) {
                            exports.appendChildByDisplayOrder(panel.$.componentContainer, panel.$groups[id]);
                        }

                        // group 容器准备好后，再把属性放进对应的 tab 或 section 子容器。
                        if (dump.groups[id].style === 'tab') {
                            exports.appendToTabGroup(panel.$groups[id], name);
                        } else if (dump.groups[id].style === 'section') {
                            exports.appendToGroup(panel.$groups[id], name);
                        }
                    }

                    if (dump.groups[id].style === 'tab') {
                        exports.appendChildByDisplayOrder(panel.$groups[id].tabs[name], $prop);
                    } else if (dump.groups[id].style === 'section') {
                        exports.appendChildByDisplayOrder(panel.$groups[id].names[name], $prop);
                    }
                } else {
                    exports.appendChildByDisplayOrder(panel.$.componentContainer, $prop);
                }
            }
        } else if (!$prop.isConnected || !$prop.parentElement) {
            if (!element || !element.isAppendToParent || element.isAppendToParent.call(panel)) {
                if (info.group && dump.groups) {
                    const { id = 'default', name } = info.group;
                    const groupStyle = dump.groups[id].style;
                    const currentGroup = panel.$groups[id];
                    const isInvalidGroup = !currentGroup
                        || (groupStyle === 'tab' && !currentGroup.tabs)
                        || (groupStyle === 'section' && !currentGroup.names);
                    if (isInvalidGroup) {
                        if (currentGroup instanceof HTMLElement) {
                            currentGroup.remove();
                        }
                        if (groupStyle === 'tab') {
                            panel.$groups[id] = exports.createTabGroup(dump.groups[id], panel);
                            exports.appendToTabGroup(panel.$groups[id], name);
                        } else if (groupStyle === 'section') {
                            panel.$groups[id] = exports.createGroup(dump.groups[id]);
                            exports.appendToGroup(panel.$groups[id], name);
                        }
                    }
                    exports.syncGroupDisplayOrder(panel.$.componentContainer, panel.$groups[id], dump.groups[id], $prop.displayOrder);
                    if (groupStyle === 'tab') {
                        exports.appendChildByDisplayOrder(panel.$groups[id].tabs[name], $prop);
                    } else if (groupStyle === 'section') {
                        exports.appendChildByDisplayOrder(panel.$groups[id].names[name], $prop);
                    }
                } else {
                    exports.appendChildByDisplayOrder(panel.$.componentContainer, $prop);
                }
            }
        }
        $prop.render(info);
    });

    for (const id of oldPropKeys) {
        if (!newPropKeys.includes(id)) {
            const $prop = panel.$props[id];
            if ($prop && $prop.parentElement) {
                $prop.parentElement.removeChild($prop);
            }
        }
    }

    for (const key in panel.elements) {
        const element = panel.elements[key];
        if (element && element.ready) {
            element.ready.call(panel, panel.$[key], dump.value);
            element.ready = undefined; // ready needs to be executed only once
        }
    }

    for (const key in panel.elements) {
        const element = panel.elements[key];
        if (element && element.update) {
            element.update.call(panel, panel.$[key], dump.value);
        }
    }

    exports.toggleGroups(panel.$groups);
};

/**
 * Tool function: check whether the value of the attribute is consistent after multi-selection
 */
exports.isMultipleInvalid = function(dump) {
    let invalid = false;

    if (dump.values && dump.values.some((ds) => ds !== dump.value)) {
        invalid = true;
    }

    return invalid;
};
/**
 * Get the name based on the dump data
 */
/**
 *
 * @param {string} dump
 * @returns
 */
exports.getName = function(dump) {
    if (!dump) {
        return '';
    }

    if (dump.displayName) {
        return dump.displayName;
    }

    let name = dump.name || '';

    name = name.trim().replace(/^\S/, (str) => str.toUpperCase());
    name = name.replace(/_/g, (str) => ' ');
    name = name.replace(/ \S/g, (str) => ` ${str.toUpperCase()}`);
    // 驼峰转中间空格
    name = name.replace(/([a-z])([A-Z])/g, '$1 $2');

    return name.trim();
};

exports.createTabGroup = function(dump, panel) {
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

    // check style
    if (!panel.$this.shadowRoot.querySelector('style#group-style')) {
        const style = document.createElement('style');
        style.setAttribute('id', 'group-style');
        style.innerText = `
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
            }`;

        panel.$.componentContainer.before(style);
    }

    setTimeout(() => {
        active(0);
    });

    return $group;
};
exports.toggleGroups = function($groups) {
    for (const key in $groups) {
        const $group = $groups[key];
        // section 分组需要看每个折叠子块里是否还有可见属性，决定标题条和内容是否显示。
        if ($group.dump.style === 'section') {
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
        const show = $props.some($prop => getComputedStyle($prop).display !== 'none');
        if (show) {
            $group.removeAttribute('hidden');
        } else {
            $group.setAttribute('hidden', '');
        }
    }
},
// section 风格的组使用独立容器，后续名字分栏和折叠状态都挂在这个节点上。
exports.createGroup = function(dump) {
    const $group = document.createElement('div');
    $group.setAttribute('class', 'ui-prop-group');
    $group.dump = dump;
    $group.names = {};
    $group.displayOrder = dump.displayOrder;
    return $group;
};
exports.syncGroupDisplayOrder = function(parent, $group, groupDump, childDisplayOrder) {
    // 组未显式配置有限 order 时，使用组内最靠前属性的顺序参与父级排序。
    // 材质面板会把未配置的组 order 初始化为 Infinity，这里需要把 Infinity 当成未配置处理。
    const groupDisplayOrder = Number(groupDump?.displayOrder);
    if (!$group || !groupDump || Number.isFinite(groupDisplayOrder)) {
        return;
    }

    const displayOrder = Number(childDisplayOrder);
    if (Number.isNaN(displayOrder)) {
        return;
    }

    const nextDisplayOrder = Number.isFinite(Number($group.displayOrder))
        ? Math.min(Number($group.displayOrder), displayOrder)
        : displayOrder;

    if ($group.displayOrder === nextDisplayOrder) {
        return;
    }

    $group.displayOrder = nextDisplayOrder;
    if ($group.isConnected) {
        $group.remove();
        exports.appendChildByDisplayOrder(parent, $group);
    }
};
// 为 section 组里的每个分栏创建一个可折叠 ui-section，并复用现有 cache-expand 规则。
exports.appendToGroup = function($group, name) {
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
    $content.setAttribute('cache-expand', parentCacheKey + '-' + name);

    const $header = document.createElement('ui-label');
    $header.setAttribute('slot', 'header');
    $header.value = exports.getName({ name });
    $content.appendChild($header);

    $group.appendChild($content);
    $group.names[name] = $content;
};
exports.appendToTabGroup = function($group, tabName) {
    if ($group.tabs[tabName]) {
        return;
    }

    const $content = document.createElement('div');

    $group.tabs[tabName] = $content;

    $content.setAttribute('class', 'tab-content');
    $content.setAttribute('name', tabName);
    $group.appendChild($content);

    const $label = document.createElement('ui-label');
    $label.value = exports.getName(tabName);

    const $button = document.createElement('ui-button');
    $button.setAttribute('name', tabName);
    $button.appendChild($label);
    $group.$header.appendChild($button);
};

exports.appendChildByDisplayOrder = function(parent, newChild) {
    const displayOrder = newChild.displayOrder || 0;
    const children = Array.from(parent.children);

    const child = children.find((child) => {
        if (child.dump && child.displayOrder > displayOrder) {
            return child;
        }

        return null;
    });

    if (child) {
        child.before(newChild);
    } else {
        parent.appendChild(newChild);
    }
};
