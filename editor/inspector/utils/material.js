'use strict';

/**
 * Pass the data of a pass under a technique and organize it into a tree structure
 * @param passData
 */
exports.buildEffect = function(index, passData) {

    const props = passData.props;
    const defs = passData.defines;

    const tree = {
        name: `Pass ${index}`,
        type: 'cc.Object',
        childMap: {},
    };

    const hideAttrs = ['USE_INSTANCING'];

    function encode(item) {
        let current = tree;

        /**
         * USE_INSTANCING is common to every child in passes
         * To make editing easier, they are referred to the outside of the passes
         * At this point, you need to set each of the passes to be non-editable and invisible
         */

        if (hideAttrs.includes(item.name)) {
            item.visible = false;
        }

        if (item.defines && item.defines.length) {
            item.defines.forEach((name) => {

                // The defines starting with ! are reverse dependencies, the data position will not change
                if (name.startsWith('!')) {
                    return;
                }

                let child = current.childMap[name];
                if (!child) {
                    child = current.childMap[name] = {
                        name,
                        // type: 'ui.Depend',
                        type: 'Boolean',
                        childMap: {},
                    };
                }
                current = child;
            });
        }

        if (current.childMap[item.name]) {
            const tempChildMap = current.childMap[item.name].childMap;
            current.childMap[item.name] = item;
            item.childMap = tempChildMap;
        } else {
            current.childMap[item.name] = item;
            item.childMap = {};
        }
        current.childMap[item.name].name = item.name;
    }

    defs.forEach((item) => {
        switch (item.type) {
            case 'Number':
                item.type = 'Enum';
                item.enumList = [];
                for (let i = item.range[0]; i <= item.range[1]; i++) {
                    item.enumList.push({
                        name: i,
                        value: i,
                    });
                }
                break;
            case 'String':
                item.type = 'Enum';
                item.enumList = item.options.map((str) => {
                    return {
                        name: str,
                        value: str,
                    };
                });
                break;
            case 'Enum': break; // Fix the problem that item.type === 'Enum' is reset to 'ui.Depend'
            default:
                // item.type = 'ui.Depend';
                item.type = 'Boolean';
        }
        encode(item);
    });
    props.forEach(encode);

    function encodeStates(item) {
        let current = tree;
        if (current.childMap[item.name]) {
            const tempChildMap = current.childMap[item.name].childMap;
            current.childMap[item.name] = item;
            item.childMap = tempChildMap;
        } else {
            current.childMap[item.name] = item;
            item.childMap = {};
        }

        if (item.isObject && item.value) {
            current = current.childMap[item.name];
            Object.keys(item.value).forEach((name) => {
                let child = current.childMap[name];
                if (!child) {
                    child = current.childMap[name] = {
                        name,
                        type: 'cc.Object',
                        childMap: {},
                    };
                }
            });
        }
    }

    function modifyType(item) {
        if (!item) {
            return;
        }

        if (item.isObject) {
            Object.keys(item.value).forEach((key) => {
                modifyType(item.value[key]);
            });
        } else if (item.isArray) {
            item.value.forEach((data) => {
                modifyType(data);
            });

            modifyType(item.elementTypeData);
        } else {
            switch (item.type) {
                case 'Number':
                    if (item.isEnum) {
                        item.type = 'Enum';
                        item.enumList = [];
                        Object.keys(item.enumData).forEach((key) => {
                            item.enumList.push({
                                name: key,
                                value: item.enumData[key],
                            });
                        });
                    }
                    break;
            }
        }
    }

    modifyType(passData.states);
    encodeStates(passData.states);


    // 将 effect editor.group 的字符串和对象写法统一成后续排序和分组使用的格式。
    function normalizeGroupInfo(group) {
        if (!group) {
            return null;
        }
        if (typeof group !== 'object') {
            return {
                id: group || 'default',
                name: group,
                style: 'section',
            };
        }
        const normalized = Object.assign({}, group);
        if (!normalized.id) {
            normalized.id = normalized.name || 'default';
        }
        if (!normalized.style) {
            normalized.style = 'section';
        }
        return normalized;
    }

    // group 优先：依赖节点没有 group，但所有子属性都属于同一 group 时，让依赖节点继承这个 group。
    function tryInheritGroupFromChildren(dump) {
        if (!dump || dump.group || !dump.childMap || typeof dump.childMap !== 'object') {
            return null;
        }

        let inheritedGroup = null;
        let hasConflict = false;
        Object.keys(dump.childMap).forEach((name) => {
            if (hasConflict) {
                return;
            }
            const child = dump.childMap[name];
            const childGroup = normalizeGroupInfo(child && child.group);
            if (!childGroup) {
                return;
            }
            if (!inheritedGroup) {
                inheritedGroup = childGroup;
                return;
            }
            if (inheritedGroup.id !== childGroup.id) {
                hasConflict = true;
            }
        });

        if (hasConflict || !inheritedGroup) {
            return null;
        }

        dump.group = inheritedGroup;
        return inheritedGroup;
    }

    // 递归收集当前层及其子层的 group 定义，给 inspector 渲染阶段准备统一的 groups 索引。
    function collectGroups(dump) {
        if (!dump) {
            return;
        }
        // 数组和对象都可能继续挂着可分组的子项，这里先把递归入口统一跑完。
        if (dump.isArray && Array.isArray(dump.value)) {
            dump.value.forEach((item) => {
                collectGroups(item);
            });
            if (dump.elementTypeData) {
                collectGroups(dump.elementTypeData);
            }
        }
        if (dump.isObject && dump.value && typeof dump.value === 'object') {
            Object.keys(dump.value).forEach((name) => {
                collectGroups(dump.value[name]);
            });
        }
        if (!dump.childMap || typeof dump.childMap !== 'object') {
            return;
        }
        Object.keys(dump.childMap).forEach((name) => {
            const info = dump.childMap[name];
            if (!info) {
                return;
            }
            collectGroups(info);
            const inheritedGroup = tryInheritGroupFromChildren(info);
            if (!info.group && !inheritedGroup) {
                return;
            }
            // 最终落到 dump.groups 前，把属性上的 group 规范成完整对象，避免后续渲染阶段重复判断。
            if (typeof info.group !== 'object') {
                const groupName = info.group;
                info.group = {
                    id: groupName || 'default',
                    name: groupName,
                    style: 'section',
                };
            } else {
                info.group = Object.assign({}, info.group);
                if (!info.group.id) {
                    info.group.id = info.group.name || 'default';
                }
                if (!info.group.style) {
                    info.group.style = 'section';
                }
            }
            // groups 以 id 聚合，供外层面板按 section/tab 样式创建真实容器。
            if (!dump.groups) {
                dump.groups = {};
            }
            const key = info.group.id || 'default';
            if (!dump.groups[key]) {
                dump.groups[key] = {
                    displayOrder: Infinity,
                    style: info.group.style || 'section',
                };
            }
            // 组定义上的额外元数据保留到 groups 上，但 id/name 仍然由容器键和值本身承载。
            const clone = JSON.parse(JSON.stringify(info.group));
            delete clone.id;
            delete clone.name;
            Object.assign(dump.groups[key], clone);
            // group 没显式 order 时，回退到当前组内最靠前属性的 order，保证组和普通属性能一起排序。
            const itemOrder = info.displayOrder !== undefined ? Number(info.displayOrder) : undefined;
            const groupOrder = info.group.displayOrder !== undefined ? Number(info.group.displayOrder) : undefined;
            const order = itemOrder !== undefined ? itemOrder : groupOrder;
            if (order !== undefined) {
                dump.groups[key].displayOrder = Math.min(Number.isFinite(dump.groups[key].displayOrder) ? dump.groups[key].displayOrder : Infinity, order);
            }
        });
    }
    function translate(item) {
        const children = Object.keys(item.childMap).map((name) => {
            const child = item.childMap[name];
            translate(child);
            return child;
        });
        if (item) {
            item.children = children;
        }
        return item;
    }
    const dump = translate(tree);
    dump.value = tree.childMap;
    // translate 只整理树结构，group 元数据需要额外补收集一次。
    collectGroups(dump);
    return dump;
};

exports.materialTechniquePolyfill = function(origin) {
    let useInstancing;
    const passes = origin.passes.map((data, index) => {
        // Merge data.defines and data.props
        const pass = exports.buildEffect(index, data);
        pass.switch = data.switch;
        pass.propertyIndex = data.propertyIndex;

        if (!useInstancing && pass.childMap.USE_INSTANCING) {
            useInstancing = JSON.parse(JSON.stringify(pass.childMap.USE_INSTANCING));
            useInstancing.visible = true;
        }
        return pass;
    });

    /**
     * USE_INSTANCING is common to every child in passes
     * For ease of editing, they are referred to outside of the passes
     * Two external variables useInstancing, useBatching are provided to dock
     * The value of the first pass takes precedence
     */
    const technique = {
        name: origin.name,
        passes,
        useInstancing,
    };

    return technique;
};
