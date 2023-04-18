import { Camera } from '../../render-scene/scene';
import { PipelineBuilder, Pipeline } from '../custom/pipeline';

import { passUtils } from './utils/pass-utils';
import { passSettings } from './utils/pass-settings';
import { BasePass } from './passes/base-pass';
import { ForwardPass } from './passes/forward-pass';
import { ForwardFinalPass } from './passes/forward-final-pass';

export class PostProcessBuilder implements PipelineBuilder  {
    passes: BasePass[] = [];

    constructor () {
        this.init();
    }

    init () {
        this.addPass(new ForwardPass());
        this.addPass(new ForwardFinalPass());
    }

    addPass (pass: BasePass) {
        this.passes.push(pass);
    }
    insertPass (pass: BasePass, prePassName: string) {
        const idx = this.passes.findIndex((p) => p.name === prePassName);
        if (idx !== -1) {
            this.passes.splice(idx + 1, 0, pass);
        }
    }

    setup (cameras: Camera[], ppl: Pipeline) {
        passSettings.renderProfiler = false;
        passUtils.ppl = ppl;

        for (let i = 0; i < cameras.length; i++) {
            const camera = cameras[i];
            if (!camera.scene) {
                continue;
            }

            passUtils.camera = camera;
            this.renderCamera(camera, ppl);
        }
    }

    renderCamera (camera: Camera, ppl: Pipeline) {

    }
}
