import { EDITOR } from 'internal:constants';

import { Format } from '../../../gfx';
import { Camera } from '../../../render-scene/scene';
import { AccessType, LightInfo, QueueHint, ResourceResidency, SceneFlags } from '../../custom';
import { getCameraUniqueID } from '../../custom/define';
import { Pipeline } from '../../custom/pipeline';
import { passUtils } from '../utils/pass-utils';
import { BasePass } from './base-pass';

export class ForwardPass extends BasePass {
    name = 'ForwardPass';
    outputNames = ['ForwardColor', 'ForwardDS']

    public render (camera: Camera, ppl: Pipeline) {
        const area = this.getRenderArea(camera);
        const width = area.width;
        const height = area.height;

        const isOffScreen = true;//director.root.mainWindow !== camera.window;

        const slot0 = this.slotName(camera, 0);
        const slot1 = this.slotName(camera, 1);

        const cameraID = getCameraUniqueID(camera);
        passUtils.addRasterPass(width, height, 'default', `${this.name}_${cameraID}`)
            .setViewport(area.x, area.y, width, height)
            .addRasterView(slot0, Format.RGB16F, isOffScreen)
            .addRasterView(slot1, Format.DEPTH_STENCIL, isOffScreen)
            .version();

        const pass = passUtils.pass!;
        pass.addQueue(QueueHint.RENDER_OPAQUE)
            .addSceneOfCamera(camera,
                new LightInfo(),
                SceneFlags.OPAQUE_OBJECT | SceneFlags.PLANAR_SHADOW | SceneFlags.CUTOUT_OBJECT
                | SceneFlags.DEFAULT_LIGHTING | SceneFlags.DRAW_INSTANCING);

        pass.addQueue(QueueHint.RENDER_TRANSPARENT)
            .addSceneOfCamera(camera,
                new LightInfo(),
                SceneFlags.UI | SceneFlags.TRANSPARENT_OBJECT | SceneFlags.GEOMETRY);
    }
}
