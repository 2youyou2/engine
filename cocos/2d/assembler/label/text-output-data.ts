/*
 Copyright (c) 2023 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights to
 use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 of the Software, and to permit persons to whom the Software is furnished to do so,
 subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
*/

import { Texture2D } from '../../../asset/assets';
import { Color, Pool, Rect, Size, Vec2 } from '../../../core';
import { SpriteFrame } from '../../assets';
import { IRenderData } from '../../renderer/render-data';

const createRenderData = (): IRenderData => ({
    x: 0,
    y: 0,
    z: 0,
    u: 0,
    v: 0,
    color: Color.WHITE.clone(),
});

const resetRenderData = (data: IRenderData): void => {
    data.x = 0;
    data.y = 0;
    data.z = 0;
    data.u = 0;
    data.v = 0;
    data.color.set(Color.WHITE);
};

const renderDataPool = new Pool<IRenderData>(createRenderData, 64);

export class TextOutputLayoutData {
    // public parsedStringStyle; // Prepare for merging richtext
    // string after process
    public parsedString: string[] = [];

    // node part
    public nodeContentSize = Size.ZERO.clone(); // both

    // Node info
    public canvasSize = new Size(); // ttf

    public canvasPadding = new Rect(); // ttf
    public contentSizeExtend = Size.ZERO.clone(); // ttf

    public startPosition = Vec2.ZERO.clone(); // ttf

    public reset (): void {
        this.parsedString.length = 0;
        this.nodeContentSize.set(0, 0);
        this.canvasSize.set();
        this.canvasPadding.set();
        this.contentSizeExtend.set();
        this.startPosition.set();
    }
}

export class TextOutputRenderData {
    // Process Output
    public quadCount = 0; // both
    public vertexBuffer: IRenderData[] = []; // both
    public texture: Texture2D | SpriteFrame | null = null;  // both

    // anchor
    public uiTransAnchorX = 0.5; // both
    public uiTransAnchorY = 0.5; // both

    public resizeVertexBuffer (count: number): void {
        this.ensureVertexBuffer(count);
        const data = this.vertexBuffer;
        const length = data.length;
        if (length > count) {
            for (let i = count; i < length; i++) {
                resetRenderData(data[i]);
                renderDataPool.free(data[i]);
            }
            data.length = count;
        }
    }

    public ensureVertexBuffer (count: number): void {
        const data = this.vertexBuffer;
        for (let i = data.length; i < count; i++) {
            const renderData = renderDataPool.alloc();
            resetRenderData(renderData);
            data.push(renderData);
        }
    }

    public reset (): void {
        this.quadCount = 0;
        this.resizeVertexBuffer(0);
        this.texture = null;
        this.uiTransAnchorX = 0.5;
        this.uiTransAnchorY = 0.5;
    }
}
