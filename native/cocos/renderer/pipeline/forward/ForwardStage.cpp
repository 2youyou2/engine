/****************************************************************************
 Copyright (c) 2020-2023 Xiamen Yaji Software Co., Ltd.

 http://www.cocos.com

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
****************************************************************************/

#include "ForwardStage.h"
#if CC_USE_GEOMETRY_RENDERER
    #include "../GeometryRenderer.h"
#endif
#include "../InstancedBuffer.h"
#include "../PipelineSceneData.h"
#include "../PipelineUBO.h"
#include "../PlanarShadowQueue.h"
#include "../RenderAdditiveLightQueue.h"
#include "../RenderInstancedQueue.h"
#include "../RenderQueue.h"
#include "../helper/Utils.h"
#include "ForwardPipeline.h"
#include "gfx-base/GFXCommandBuffer.h"
#include "gfx-base/GFXFramebuffer.h"
#include "pipeline/UIPhase.h"
#include "profiler/Profiler.h"
#include "scene/Camera.h"
#include "scene/RenderWindow.h"

namespace cc {
namespace pipeline {

RenderStageInfo ForwardStage::initInfo = {
    "ForwardStage",
    static_cast<uint32_t>(ForwardStagePriority::FORWARD),
    static_cast<uint32_t>(RenderFlowTag::SCENE),
    {new RenderQueueDesc{false, RenderQueueSortMode::FRONT_TO_BACK, {"default"}},
     new RenderQueueDesc{true, RenderQueueSortMode::BACK_TO_FRONT, {"default", "planarShadow"}}}};
const RenderStageInfo &ForwardStage::getInitializeInfo() { return ForwardStage::initInfo; }

ForwardStage::ForwardStage() {
    _instancedQueue = ccnew RenderInstancedQueue;
    _uiPhase = ccnew UIPhase;
}

ForwardStage::~ForwardStage() = default;

bool ForwardStage::initialize(const RenderStageInfo &info) {
    RenderStage::initialize(info);
    _renderQueueDescriptors = info.renderQueues;
    _phaseID = getPhaseID("default");
    return true;
}

void ForwardStage::activate(RenderPipeline *pipeline, RenderFlow *flow) {
    RenderStage::activate(pipeline, flow);

    for (const auto &descriptor : _renderQueueDescriptors) {
        uint32_t phase = convertPhase(descriptor->stages);
        RenderQueueSortFunc sortFunc = convertQueueSortFunc(descriptor->sortMode);
        RenderQueueCreateInfo info = {descriptor->isTransparent, phase, sortFunc};
        _renderQueues.emplace_back(ccnew RenderQueue(_pipeline, std::move(info), true));
    }

    _additiveLightQueue = ccnew RenderAdditiveLightQueue(_pipeline);
    _planarShadowQueue = ccnew PlanarShadowQueue(_pipeline);
    _uiPhase->activate(pipeline);
}

void ForwardStage::destroy() {
    CC_SAFE_DELETE(_instancedQueue);
    CC_SAFE_DELETE(_additiveLightQueue);
    CC_SAFE_DESTROY_AND_DELETE(_planarShadowQueue);
    CC_SAFE_DELETE(_uiPhase);
    RenderStage::destroy();
}

void ForwardStage::dispenseRenderObject2Queues() {
    if (!_pipeline->isRenderQueueReset()) return;

    _instancedQueue->clear();

    const auto *sceneData = _pipeline->getPipelineSceneData();
    const auto &renderObjects = sceneData->getRenderObjects();

    for (auto *queue : _renderQueues) {
        queue->clear();
    }

    for (const auto &ro : renderObjects) {
        const auto *const model = ro.model;
        const auto &subModels = model->getSubModels();
        const auto subModelCount = subModels.size();
        for (uint32_t subModelIdx = 0; subModelIdx < subModelCount; ++subModelIdx) {
            const auto &subModel = subModels[subModelIdx];
            const auto &passes = *(subModel->getPasses());
            const auto passCount = passes.size();
            for (uint32_t passIdx = 0; passIdx < passCount; ++passIdx) {
                const auto &pass = passes[passIdx];
                if (pass->getPhase() != _phaseID) continue;
                if (pass->getBatchingScheme() == scene::BatchingSchemes::INSTANCING) {
                    auto *instancedBuffer = pass->getInstancedBuffer();
                    instancedBuffer->merge(subModel, passIdx);
                    _instancedQueue->add(instancedBuffer);
                } else {
                    for (auto *renderQueue : _renderQueues) {
                        renderQueue->insertRenderPass(ro, subModelIdx, passIdx);
                    }
                }
            }
        }
    }

    _instancedQueue->sort();

    for (auto *queue : _renderQueues) {
        queue->sort();
    }
}

void ForwardStage::render(scene::Camera *camera) {
    CC_PROFILE(ForwardStageRender);
    struct RenderData {
        framegraph::TextureHandle outputTex;
        framegraph::TextureHandle depth;
    };
    auto *pipeline = static_cast<ForwardPipeline *>(_pipeline);
    auto *const sceneData = _pipeline->getPipelineSceneData();

    float shadingScale{sceneData->getShadingScale()};
    _renderArea = RenderPipeline::getRenderArea(camera);
    // Command 'updateBuffer' must be recorded outside render passes, cannot put them in execute lambda
    dispenseRenderObject2Queues();
    auto *cmdBuff{pipeline->getCommandBuffers()[0]};
    pipeline->getPipelineUBO()->updateShadowUBO(camera);

    _instancedQueue->uploadBuffers(cmdBuff);
    _additiveLightQueue->gatherLightPasses(camera, cmdBuff);
    _planarShadowQueue->gatherShadowPasses(camera, cmdBuff);

    auto framebuffer = camera->getWindow()->getFramebuffer();

    auto renderPass = camera->getRenderPass();
    if (!renderPass) {
        renderPass = framebuffer->getRenderPass();
    }


    cmdBuff->beginRenderPass(renderPass, framebuffer, _renderArea,
                               _clearColors, camera->getClearDepth(), camera->getClearStencil());

    auto offset = _pipeline->getPipelineUBO()->getCurrentCameraUBOOffset();

    cmdBuff->bindDescriptorSet(globalSet, _pipeline->getDescriptorSet(), 1, &offset);
    if (!_pipeline->getPipelineSceneData()->getRenderObjects().empty()) {
        _renderQueues[0]->recordCommandBuffer(_device, camera, renderPass, cmdBuff);
        _instancedQueue->recordCommandBuffer(_device, renderPass, cmdBuff);
        _additiveLightQueue->recordCommandBuffer(_device, camera, renderPass, cmdBuff);

        cmdBuff->bindDescriptorSet(globalSet, _pipeline->getDescriptorSet(), 1, &offset);
        _planarShadowQueue->recordCommandBuffer(_device, renderPass, cmdBuff);
        _renderQueues[1]->recordCommandBuffer(_device, camera, renderPass, cmdBuff);
    }

    auto &blitTextures = camera->getBlitTextures();
    for (auto& blit : blitTextures) {
        cmdBuff->blitTexture(blit.getSrc(), blit.getDst(), blit.getRegions(), blit.getFilter());
    }

#if CC_USE_GEOMETRY_RENDERER
    if (camera->getGeometryRenderer()) {
        camera->getGeometryRenderer()->render(renderPass, cmdBuff, pipeline->getPipelineSceneData());
    }
#endif

    _uiPhase->render(camera, renderPass);
    renderProfiler(renderPass, cmdBuff, _pipeline->getProfiler(), camera);
#if CC_USE_DEBUG_RENDERER
    renderDebugRenderer(renderPass, cmdBuff, _pipeline->getPipelineSceneData(), camera);
#endif

    cmdBuff->endRenderPass();
}

} // namespace pipeline
} // namespace cc
