import { EDITOR } from 'internal:constants';

import { QueueHint, ResourceDimension, ResourceFlags, ResourceResidency, SceneFlags } from '../../custom/types';
import { ClearFlagBit, Color, Format, LoadOp, Rect, StoreOp, Viewport } from '../../../gfx';
import { MultisampleRenderPassBuilder, Pipeline, RenderPassBuilder } from '../../custom/pipeline';
import { Camera } from '../../../render-scene/scene';
import { Material } from '../../../asset/assets';
import { PostProcess } from '../components';
import { getRenderArea } from '../../custom/define';
import { Vec4 } from '../../../core';

export class PassContext {
    clearFlag: ClearFlagBit = ClearFlagBit.COLOR;
    clearColor = new Color();
    clearDepthColor = new Color();
    ppl: Pipeline| undefined;
    camera: Camera| undefined;
    material: Material| undefined;
    pass: RenderPassBuilder| undefined;
    rasterWidth = 0;
    rasterHeight = 0;
    layoutName = '';

    shadingScale = 1;
    viewport = new Rect();
    passViewport = new Rect();

    passPathName = '';
    passVersion = 0;

    isFinalCamera = false;
    isFinalPass = false;

    depthSlotName = '';

    shadowPass: any = undefined;
    forwardPass: any = undefined;
    postProcess: PostProcess | undefined;

    sampleCount = 1;

    setClearFlag (clearFlag: ClearFlagBit): PassContext {
        this.clearFlag = clearFlag;
        return this;
    }

    setClearColor (x: number, y: number, z: number, w: number): PassContext {
        Vec4.set(this.clearColor, x, y, z, w);
        return this;
    }

    setClearDepthColor (x: number, y: number, z: number, w: number): PassContext {
        Vec4.set(this.clearDepthColor, x, y, z, w);
        return this;
    }

    version (): PassContext {
        if (!EDITOR) {
            this.passPathName += `_${this.pass!.name}_${this.layoutName}`;
            this.pass!.setVersion(this.passPathName, this.passVersion);
        }
        return this;
    }

    clearBlack (): void {
        this.clearFlag = ClearFlagBit.COLOR;
        Vec4.set(passContext.clearColor, 0, 0, 0, 1);
    }

    addRenderPass (layoutName: string, passName: string, sampleCount = 1): PassContext {
        const passViewport = this.passViewport;
        let pass;

        if (sampleCount > 1) {
            pass = this.ppl!.addMultisampleRenderPass(passViewport.width, passViewport.height, sampleCount, 1, layoutName);

        }
        else {
            pass = this.ppl!.addRenderPass(passViewport.width, passViewport.height, layoutName);
        }

        this.sampleCount = sampleCount;

        pass.name = passName;
        this.pass = pass;
        this.layoutName = layoutName;

        this.rasterWidth = passViewport.width;
        this.rasterHeight = passViewport.height;

        pass.setViewport(new Viewport(passViewport.x, passViewport.y, passViewport.width, passViewport.height));

        return this;
    }

    updateViewPort (): void {
        const camera = this.camera;
        if (!camera) {
            return;
        }

        let shadingScale = 1;
        if (this.postProcess && (!EDITOR || this.postProcess.enableShadingScaleInEditor)) {
            shadingScale *= this.postProcess.shadingScale;
        }
        this.shadingScale = shadingScale;

        const area = getRenderArea(camera, camera.window.width * shadingScale, camera.window.height * shadingScale, null, 0, this.viewport);
        area.width = Math.floor(area.width);
        area.height = Math.floor(area.height);
    }
    updatePassViewPort (shadingScale = 1, offsetScale = 0): PassContext {
        this.passViewport.width = this.viewport.width * shadingScale;
        this.passViewport.height = this.viewport.height * shadingScale;

        this.passViewport.x = this.viewport.x * offsetScale;
        this.passViewport.y = this.viewport.y * offsetScale;
        return this;
    }

    // setViewport (x: number, y: number, w: number, h: number) {
    //     this.pass!.setViewport(new Viewport(x, y, w, h));
    //     return this;
    // }

    addRasterView (name: string, format: Format, offscreen = true, residency?: ResourceResidency): PassContext {
        const ppl = this.ppl;
        const camera = this.camera;
        const pass = this.pass;
        if (!ppl || !camera || !pass) {
            return this;
        }

        let isMultiSample = this.sampleCount > 1;
        let multiSampleName = name + '_ms';

        if (!ppl.containsResource(name)) {
            if (format === Format.DEPTH_STENCIL) {
                ppl.addDepthStencil(name, format, this.rasterWidth, this.rasterHeight, ResourceResidency.MANAGED);
            } else if (offscreen) {
                ppl.addRenderTarget(name, format, this.rasterWidth, this.rasterHeight, residency || ResourceResidency.MANAGED);
            } else {
                ppl.addRenderWindow(name, format, this.rasterWidth, this.rasterHeight, camera.window);
            }

            if (isMultiSample) {
                let resourceFlag = ResourceFlags.COLOR_ATTACHMENT;
                if (format === Format.DEPTH_STENCIL) {
                    resourceFlag = ResourceFlags.DEPTH_STENCIL_ATTACHMENT;
                }

                ppl.addResource(multiSampleName, ResourceDimension.TEXTURE2D,
                    format,
                    this.rasterWidth, this.rasterHeight,
                    1, 1, 1,
                    this.sampleCount,
                    resourceFlag,
                    ResourceResidency.MEMORYLESS);
            }
        }

        if (format !== Format.DEPTH_STENCIL) {
            if (!offscreen) {
                ppl.updateRenderWindow(name, camera.window);
            } else {
                ppl.updateRenderTarget(name, this.rasterWidth, this.rasterHeight);
            }
        } else {
            ppl.updateDepthStencil(name, this.rasterWidth, this.rasterHeight);
        }

        if (isMultiSample){
            ppl.updateResource(multiSampleName, format, this.rasterWidth, this.rasterHeight, 1, 1, 1, this.sampleCount);
        }

        let resPassName = name;
        if (isMultiSample) {
            resPassName = multiSampleName;
        } 
        // let view: RasterView;
        if (format === Format.DEPTH_STENCIL) {
            const clearFlag = this.clearFlag & ClearFlagBit.DEPTH_STENCIL;
            let loadOp = LoadOp.CLEAR;
            if (clearFlag === ClearFlagBit.NONE) {
                loadOp = LoadOp.LOAD;
            }

            pass.addDepthStencil(resPassName, loadOp, StoreOp.STORE, this.clearDepthColor.x, this.clearDepthColor.y, clearFlag);

            if (isMultiSample) {
                (pass as any as MultisampleRenderPassBuilder).resolveDepthStencil(multiSampleName, name);
            }
        } else {
            const clearColor = new Color();
            clearColor.copy(this.clearColor);

            const clearFlag = this.clearFlag & ClearFlagBit.COLOR;
            let loadOp = LoadOp.CLEAR;
            if (clearFlag === ClearFlagBit.NONE) {
                loadOp = LoadOp.LOAD;
            }

            pass.addRenderTarget(resPassName, loadOp, StoreOp.STORE, clearColor);

            if (isMultiSample) {
                (pass as any as MultisampleRenderPassBuilder).resolveRenderTarget(multiSampleName, name);
            }
        }

        return this;
    }
    setPassInput (inputName: string, shaderName: string): PassContext {
        if (this.ppl!.containsResource(inputName)) {
            this.pass!.addTexture(inputName, shaderName);
        }
        return this;
    }

    blitScreen (passIdx = 0): PassContext {
        this.pass!.addQueue(QueueHint.RENDER_TRANSPARENT).addCameraQuad(
            this.camera!,
this.material!,
passIdx,
SceneFlags.NONE,
        );
        return this;
    }
}

export const passContext = new PassContext();
