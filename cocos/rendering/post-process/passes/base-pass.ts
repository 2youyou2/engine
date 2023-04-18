import { EDITOR } from 'internal:constants';

import { Material, RenderTexture } from '../../../asset/assets';
import { director } from '../../../game';
import { Rect } from '../../../gfx';
import { Camera } from '../../../render-scene/scene';
import { getCameraUniqueID, getRenderArea } from '../../custom/define';
import { Pipeline } from '../../custom/pipeline';
import { passSettings } from '../utils/pass-settings';
import { passUtils } from '../utils/pass-utils';

let _BasePassID = 0;

export class BasePass {
    _id = 0
    constructor () {
        this._id = _BasePassID++;
    }

    _effectName = 'blit-screen';
    _material: Material | undefined
    get material () {
        if (!this._material) {
            const mat = new Material();
            mat._uuid = `${this.name}-${this._effectName}-material`;
            mat.initialize({ effectName: this._effectName });
            this._material = mat;
        }
        return this._material;
    }

    name = 'BasePass';
    enable = true;
    shadingScale = 1;
    outputNames: string[] = []

    lastPass: BasePass | undefined;

    slotName (camera: Camera, index = 0) {
        const name = this.outputNames[index] + this.name;
        return `${name}_${this._id}_${getCameraUniqueID(camera)}`;
    }

    finalShadingScale () {
        return this.shadingScale * director.root!.pipeline.pipelineSceneData.shadingScale;
    }

    checkEnable () {
        return this.enable;
    }

    renderProfiler (camera) {
        if (passSettings.renderProfiler && !EDITOR) {
            passUtils.pass!.showStatistics = true;
            passSettings.renderProfiler = false;
        }
    }

    _renderArea = new Rect()
    getRenderArea (camera) {
        const shadingScale = this.finalShadingScale();
        const area = getRenderArea(camera, camera.window.width * shadingScale, camera.window.height * shadingScale, null, 0, this._renderArea);
        area.width = Math.floor(area.width);
        area.height = Math.floor(area.height);
        return area;
    }

    public render (camera: Camera, ppl: Pipeline) {

    }
}
