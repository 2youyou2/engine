/*
 Copyright (c) 2022-2023 Xiamen Yaji Software Co., Ltd.

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

import { EffectAsset } from '../../asset/assets';
import { CollectVisitor, WebDescriptorHierarchy } from './web-descriptor-hierarchy';
// eslint-disable-next-line max-len
import { DescriptorBlockData, DescriptorDB, LayoutGraph, LayoutGraphData, LayoutGraphValue, ShaderProgramData } from './layout-graph';
import { LayoutGraphBuilder, Pipeline } from './pipeline';
import { ShaderStageFlagBit, Type, UniformBlock } from '../../gfx';
import { Descriptor, DescriptorBlock, DescriptorBlockFlattened, DescriptorBlockIndex, DescriptorTypeOrder,
    ParameterType, UpdateFrequency } from './types';
import { depthFirstSearch, GraphColor, MutableVertexPropertyMap } from './graph';
import { SetIndex } from '../define';

function descriptorBlock2Flattened (block: DescriptorBlock, flattened: DescriptorBlockFlattened): void {
    block.descriptors.forEach((value, key) => {
        const name: string = key;
        const d: Descriptor = value;
        flattened.descriptorNames.push(name);
        flattened.descriptors.push(d);
    });
    block.uniformBlocks.forEach((value, key) => {
        const name: string = key;
        const u: UniformBlock = value;
        flattened.uniformBlockNames.push(name);
        flattened.uniformBlocks.push(u);
    });
    flattened.count = block.count;
    flattened.capacity = block.capacity;
}

export function buildLayoutGraphDataImpl (graph: LayoutGraph, lgData: LayoutGraphBuilder) {
    for (const v of graph.vertices()) {
        const db: DescriptorDB = graph.getDescriptors(v);
        let vid = 0;
        if (graph.id(v) === LayoutGraphValue.RenderStage) {
            vid = lgData.addRenderStage(graph.getName(v));
        }
        if (graph.id(v) === LayoutGraphValue.RenderPhase) {
            vid = lgData.addRenderPhase(graph.getName(v), graph.getParent(v));
            const phase = graph.getRenderPhase(vid);
            for (const shaderName of phase.shaders) {
                lgData.addShader(shaderName, vid);
            }
        }

        db.blocks.forEach((value, key) => {
            const index: DescriptorBlockIndex = JSON.parse(key) as DescriptorBlockIndex;
            const block: DescriptorBlock = value;
            const flattened = new DescriptorBlockFlattened();
            descriptorBlock2Flattened(block, flattened);
            if (block.capacity > 0) {
                lgData.addDescriptorBlock(vid, index, flattened);
            }
            for (let i = 0; i < flattened.uniformBlockNames.length; ++i) {
                lgData.addUniformBlock(vid, index, flattened.uniformBlockNames[i], flattened.uniformBlocks[i]);
            }
        });
    }
}

enum BloomStage {
    PREFILTER,
    DOWNSAMPLE,
    UPSAMPLE,
    COMBINE
}

function buildBloomDownSample (lg, idx: number) {
    const bloomDownsampleID = lg.addRenderStage(`Bloom_Downsample${idx}`, BloomStage.DOWNSAMPLE);
    lg.addRenderPhase('Queue', bloomDownsampleID);
    const bloomDownsampleDescriptors = lg.layoutGraph.getDescriptors(bloomDownsampleID);

    const bloomDownsampleUniformBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.UNIFORM_BUFFER,
        ShaderStageFlagBit.ALL,
        bloomDownsampleDescriptors);
    const bloomDownsampleUBO: UniformBlock = lg.getUniformBlock(SetIndex.MATERIAL,
        0, 'BloomUBO', bloomDownsampleUniformBlock);
    lg.setUniform(bloomDownsampleUBO, 'texSize', Type.FLOAT4, 1);
    lg.setDescriptor(bloomDownsampleUniformBlock, 'BloomUBO', Type.UNKNOWN);

    const bloomDownsamplePassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        bloomDownsampleDescriptors);
    lg.setDescriptor(bloomDownsamplePassBlock, 'bloomTexture', Type.SAMPLER2D);
    lg.merge(bloomDownsampleDescriptors);
    lg.mergeDescriptors(bloomDownsampleID);
}

function buildBloomUpSample (lg, idx: number) {
    const bloomUpsampleID = lg.addRenderStage(`Bloom_Upsample${idx}`, BloomStage.UPSAMPLE);
    lg.addRenderPhase('Queue', bloomUpsampleID);
    const bloomUpsampleDescriptors = lg.layoutGraph.getDescriptors(bloomUpsampleID);

    const bloomUpsampleUniformBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.UNIFORM_BUFFER,
        ShaderStageFlagBit.ALL,
        bloomUpsampleDescriptors);
    const bloomUpsampleUBO: UniformBlock = lg.getUniformBlock(SetIndex.MATERIAL,
        0, 'BloomUBO', bloomUpsampleUniformBlock);
    lg.setUniform(bloomUpsampleUBO, 'texSize', Type.FLOAT4, 1);
    lg.setDescriptor(bloomUpsampleUniformBlock, 'BloomUBO', Type.UNKNOWN);

    const bloomCombineSamplePassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        bloomUpsampleDescriptors);
    lg.setDescriptor(bloomCombineSamplePassBlock, 'outputResultMap', Type.SAMPLER2D);
    const bloomCombineSamplePassBlock2 = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        bloomUpsampleDescriptors);
    lg.setDescriptor(bloomCombineSamplePassBlock2, 'bloomTexture', Type.SAMPLER2D);
    lg.merge(bloomUpsampleDescriptors);
    lg.mergeDescriptors(bloomUpsampleID);
}

export function buildForwardLayout (ppl: Pipeline) {
    const lg = new WebDescriptorHierarchy();

    const defaultID = lg.addGlobal('default', true, true, true, true, true, true, true, true);
    lg.mergeDescriptors(defaultID);
    // 1.=== Bloom prefilter ===
    const bloomPrefilterID = lg.addRenderStage('Bloom_Prefilter', BloomStage.PREFILTER);
    lg.addRenderPhase('Queue', bloomPrefilterID);
    const bloomPrefilterDescriptors = lg.layoutGraph.getDescriptors(bloomPrefilterID);
    // unifom
    const bloomPrefilterUniformBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.UNIFORM_BUFFER,
        ShaderStageFlagBit.ALL,
        bloomPrefilterDescriptors);
    const bloomPrefilterUBO: UniformBlock = lg.getUniformBlock(SetIndex.MATERIAL,
        0, 'BloomUBO', bloomPrefilterUniformBlock);
    lg.setUniform(bloomPrefilterUBO, 'texSize', Type.FLOAT4, 1);
    lg.setDescriptor(bloomPrefilterUniformBlock, 'BloomUBO', Type.UNKNOWN);
    // texture
    const bloomPrefilterPassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        bloomPrefilterDescriptors);
    lg.setDescriptor(bloomPrefilterPassBlock, 'outputResultMap', Type.SAMPLER2D);
    lg.merge(bloomPrefilterDescriptors);
    lg.mergeDescriptors(bloomPrefilterID);
    // 2.=== Bloom downsample ===
    buildBloomDownSample(lg, 0);
    buildBloomDownSample(lg, 1);
    // 3.=== Bloom upsample ===
    buildBloomUpSample(lg, 0);
    buildBloomUpSample(lg, 1);
    // 4.=== Bloom combine ===
    const bloomCombineSampleID = lg.addRenderStage('Bloom_Combine', BloomStage.COMBINE);
    lg.addRenderPhase('Queue', bloomCombineSampleID);
    const bloomCombineSampleDescriptors = lg.layoutGraph.getDescriptors(bloomCombineSampleID);

    const bloomCombinesampleUniformBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.UNIFORM_BUFFER,
        ShaderStageFlagBit.ALL,
        bloomCombineSampleDescriptors);
    const bloomCombinesampleUBO: UniformBlock = lg.getUniformBlock(SetIndex.MATERIAL,
        0, 'BloomUBO', bloomCombinesampleUniformBlock);
    lg.setUniform(bloomCombinesampleUBO, 'texSize', Type.FLOAT4, 1);
    lg.setDescriptor(bloomCombinesampleUniformBlock, 'BloomUBO', Type.UNKNOWN);

    const bloomCombineSamplePassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        bloomCombineSampleDescriptors);
    lg.setDescriptor(bloomCombineSamplePassBlock, 'outputResultMap', Type.SAMPLER2D);
    const bloomCombineSamplePassBlock2 = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        bloomCombineSampleDescriptors);
    lg.setDescriptor(bloomCombineSamplePassBlock2, 'bloomTexture', Type.SAMPLER2D);
    lg.merge(bloomCombineSampleDescriptors);
    lg.mergeDescriptors(bloomCombineSampleID);
    // 5.=== Postprocess ===
    const postPassID = lg.addRenderStage('Postprocess', DeferredStage.POST);
    const postDescriptors = lg.layoutGraph.getDescriptors(postPassID);
    const postPassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        postDescriptors);

    lg.setDescriptor(postPassBlock, 'outputResultMap', Type.SAMPLER2D);
    lg.merge(postDescriptors);
    lg.mergeDescriptors(postPassID);

    // 6.=== FxaaHQ ===
    const fxaaID = lg.addRenderStage('fxaa', 1);
    lg.addRenderPhase('Queue', fxaaID);
    const fxaaDescriptors = lg.layoutGraph.getDescriptors(fxaaID);
    // unifom
    const fxaaUniformBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.UNIFORM_BUFFER,
        ShaderStageFlagBit.ALL,
        fxaaDescriptors);
    const fxaaUBO: UniformBlock = lg.getUniformBlock(SetIndex.MATERIAL,
        0, 'fxaaUBO', fxaaUniformBlock);
    lg.setUniform(fxaaUBO, 'texSize', Type.FLOAT4, 1);
    lg.setDescriptor(fxaaUniformBlock, 'fxaaUBO', Type.UNKNOWN);
    // texture
    const fxaaPassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        fxaaDescriptors);
    lg.setDescriptor(fxaaPassBlock, 'sceneColorMap', Type.SAMPLER2D);
    lg.merge(fxaaDescriptors);
    lg.mergeDescriptors(fxaaID);

    // 7. === blit === 
    let tempID = 0
    const blitPassID = lg.addRenderStage('Blit', tempID++);
    lg.addRenderPhase('Queue', blitPassID);
    const blitDescriptors = lg.layoutGraph.getDescriptors(blitPassID);
    const blitPassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        blitDescriptors);

    lg.setDescriptor(blitPassBlock, 'inputTexture', Type.SAMPLER2D);
    lg.merge(blitDescriptors);
    lg.mergeDescriptors(blitPassID);

    const builder = ppl.layoutGraphBuilder;
    builder.clear();
    buildLayoutGraphDataImpl(lg.layoutGraph, builder);
}

enum DeferredStage {
    GEOMETRY,
    LIGHTING,
    POST
}

export class VectorGraphColorMap implements MutableVertexPropertyMap<GraphColor> {
    constructor (sz: number) {
        this.colors = new Array<GraphColor>(sz);
    }
    get (u: number): GraphColor {
        return this.colors[u];
    }
    put (u: number, value: GraphColor): void {
        this.colors[u] = value;
    }
    readonly colors: Array<GraphColor>;
}

export function buildDeferredLayout (ppl: Pipeline) {
    const lg = new WebDescriptorHierarchy();
    const defaultID = lg.addGlobal('default', true, true, true, true, true, true, true, true);
    lg.mergeDescriptors(defaultID);
    const geometryPassID = lg.addRenderStage('Geometry', DeferredStage.GEOMETRY);
    const lightingPassID = lg.addRenderStage('Lighting', DeferredStage.LIGHTING);
    const postPassID = lg.addRenderStage('Postprocess', DeferredStage.POST);

    const geometryQueueID = lg.addRenderPhase('Queue', geometryPassID);
    const lightingQueueID = lg.addRenderPhase('Queue', lightingPassID);
    const postQueueID = lg.addRenderPhase('Queue', postPassID);

    const lightingDescriptors = lg.layoutGraph.getDescriptors(lightingQueueID);

    const lightingPassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        lightingDescriptors);

    lg.setDescriptor(lightingPassBlock, 'CustomLightingUBO', Type.UNKNOWN);
    
    lg.setDescriptor(lightingPassBlock, 'light_cluster_InfoTexture', Type.FLOAT4);
    lg.setDescriptor(lightingPassBlock, 'light_cluster_Texture', Type.SAMPLER2D);

    lg.setDescriptor(lightingPassBlock, 'light_ibl_Texture0', Type.SAMPLER2D);
    lg.setDescriptor(lightingPassBlock, 'light_ibl_Texture1', Type.SAMPLER2D);
    lg.setDescriptor(lightingPassBlock, 'light_ibl_Texture2', Type.SAMPLER2D);

    lg.setDescriptor(lightingPassBlock, 'gbuffer_albedoMap', Type.FLOAT4);
    lg.setDescriptor(lightingPassBlock, 'gbuffer_normalMap', Type.FLOAT4);
    lg.setDescriptor(lightingPassBlock, 'gbuffer_emissiveMap', Type.FLOAT4);
    lg.setDescriptor(lightingPassBlock, 'gbuffer_posMap', Type.FLOAT4);

    const visitor = new CollectVisitor();
    const colorMap = new VectorGraphColorMap(lg.layoutGraph.numVertices());
    depthFirstSearch(lg.layoutGraph, visitor, colorMap);

    lg.mergeDescriptors(lightingPassID);
    // Postprocess
    const postDescriptors = lg.layoutGraph.getDescriptors(postPassID);

    const postPassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        postDescriptors);

    lg.setDescriptor(postPassBlock, 'PostUBO', Type.UNKNOWN);
    lg.setDescriptor(postPassBlock, 'outputResultMap', Type.FLOAT4);
    lg.merge(postDescriptors);
    lg.mergeDescriptors(postPassID);


    // taa
    for (let i = 0; i < 3; i++) {
        const taaPassID = lg.addRenderStage('DeferredTAA' + (i-1), DeferredStage.POST+1);
        lg.addRenderPhase('Queue', taaPassID);
        const taaDescriptors = lg.layoutGraph.getDescriptors(taaPassID);

        const taaPassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
            ParameterType.TABLE,
            DescriptorTypeOrder.SAMPLER_TEXTURE,
            ShaderStageFlagBit.FRAGMENT,
            taaDescriptors);

        lg.setDescriptor(taaPassBlock, 'TaaUBO', Type.UNKNOWN);
        lg.setDescriptor(taaPassBlock, 'inputTexture', Type.FLOAT4);
        lg.setDescriptor(taaPassBlock, 'depthBuffer', Type.FLOAT4);
        lg.setDescriptor(taaPassBlock, 'taaPrevTexture', Type.FLOAT4);
        lg.merge(taaDescriptors);
        lg.mergeDescriptors(taaPassID);
    }
    
    
    //  === blit === 
    let tempID = 0
    const blitPassID = lg.addRenderStage('Blit', tempID++);
    lg.addRenderPhase('Queue', blitPassID);
    const blitDescriptors = lg.layoutGraph.getDescriptors(blitPassID);
    const blitPassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        blitDescriptors);

    lg.setDescriptor(blitPassBlock, 'inputTexture', Type.SAMPLER2D);
    lg.merge(blitDescriptors);
    lg.mergeDescriptors(blitPassID);


    // 1.=== Bloom prefilter ===
    const bloomPrefilterID = lg.addRenderStage('Bloom_Prefilter', BloomStage.PREFILTER);
    lg.addRenderPhase('Queue', bloomPrefilterID);
    const bloomPrefilterDescriptors = lg.layoutGraph.getDescriptors(bloomPrefilterID);
    // unifom
    const bloomPrefilterUniformBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.UNIFORM_BUFFER,
        ShaderStageFlagBit.ALL,
        bloomPrefilterDescriptors);
    const bloomPrefilterUBO: UniformBlock = lg.getUniformBlock(SetIndex.MATERIAL,
        0, 'BloomUBO', bloomPrefilterUniformBlock);
    lg.setUniform(bloomPrefilterUBO, 'texSize', Type.FLOAT4, 1);
    lg.setDescriptor(bloomPrefilterUniformBlock, 'BloomUBO', Type.UNKNOWN);
    // texture
    const bloomPrefilterPassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        bloomPrefilterDescriptors);
    lg.setDescriptor(bloomPrefilterPassBlock, 'outputResultMap', Type.SAMPLER2D);
    lg.merge(bloomPrefilterDescriptors);
    lg.mergeDescriptors(bloomPrefilterID);

    let MAX_BLOOM_FILTER_PASS_NUM = 6;
    // 2.=== Bloom downsample ===
    for (let i = 0; i < MAX_BLOOM_FILTER_PASS_NUM; i++) {
        buildBloomDownSample(lg, i);
    }
    // 3.=== Bloom upsample ===
    for (let i = 0; i < MAX_BLOOM_FILTER_PASS_NUM; i++) {
        buildBloomUpSample(lg, i);
    }

    // 4.=== Bloom combine ===
    const bloomCombineSampleID = lg.addRenderStage('Bloom_Combine', BloomStage.COMBINE);
    lg.addRenderPhase('Queue', bloomCombineSampleID);
    const bloomCombineSampleDescriptors = lg.layoutGraph.getDescriptors(bloomCombineSampleID);

    const bloomCombinesampleUniformBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.UNIFORM_BUFFER,
        ShaderStageFlagBit.ALL,
        bloomCombineSampleDescriptors);
    const bloomCombinesampleUBO: UniformBlock = lg.getUniformBlock(SetIndex.MATERIAL,
        0, 'BloomUBO', bloomCombinesampleUniformBlock);
    lg.setUniform(bloomCombinesampleUBO, 'texSize', Type.FLOAT4, 1);
    lg.setDescriptor(bloomCombinesampleUniformBlock, 'BloomUBO', Type.UNKNOWN);

    const bloomCombineSamplePassBlock = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        bloomCombineSampleDescriptors);
    lg.setDescriptor(bloomCombineSamplePassBlock, 'outputResultMap', Type.SAMPLER2D);
    const bloomCombineSamplePassBlock2 = lg.getLayoutBlock(UpdateFrequency.PER_PASS,
        ParameterType.TABLE,
        DescriptorTypeOrder.SAMPLER_TEXTURE,
        ShaderStageFlagBit.FRAGMENT,
        bloomCombineSampleDescriptors);
    lg.setDescriptor(bloomCombineSamplePassBlock2, 'bloomTexture', Type.SAMPLER2D);
    lg.merge(bloomCombineSampleDescriptors);
    lg.mergeDescriptors(bloomCombineSampleID);

    if (visitor.error) {
        console.log(visitor.error);
    }

    const builder = ppl.layoutGraphBuilder;
    builder.clear();
    buildLayoutGraphDataImpl(lg.layoutGraph, builder);

}

function applyBinding (lg: Readonly<LayoutGraphData>,
    descId: number,
    srcBlock: EffectAsset.IBlockInfo | EffectAsset.IBufferInfo | EffectAsset.ISamplerTextureInfo | EffectAsset.ISamplerInfo,
    dstBlock: DescriptorBlockData) {
    if (lg.attributeIndex.get(srcBlock.name) === descId) {
        srcBlock.stageFlags = dstBlock.visibility;
        srcBlock.binding = dstBlock.offset;
    }
}

function updateShaderBinding (lg: Readonly<LayoutGraphData>,
    shaderData: Readonly<ShaderProgramData>,
    shader: EffectAsset.IShaderInfo) {
    for (const pair of shaderData.layout.descriptorSets) {
        const updateFrequency = pair[0];
        if (updateFrequency === UpdateFrequency.PER_BATCH
            || updateFrequency === UpdateFrequency.PER_INSTANCE) {
            continue;
        }
        const descData = pair[1];
        for (const descBlock of descData.descriptorSetLayoutData.descriptorBlocks) {
            for (let j = 0; j < descBlock.descriptors.length; ++j) {
                const descData = descBlock.descriptors[j];
                const descriptorId = descData.descriptorID;
                for (const block of shader.blocks) {
                    applyBinding(lg, descriptorId, block, descBlock);
                }
                for (const buff of shader.buffers) {
                    applyBinding(lg, descriptorId, buff, descBlock);
                }
                for (const img of shader.images) {
                    applyBinding(lg, descriptorId, img, descBlock);
                }
                for (const samplerTex of shader.samplerTextures) {
                    applyBinding(lg, descriptorId, samplerTex, descBlock);
                }
                for (const sampler of shader.samplers) {
                    applyBinding(lg, descriptorId, sampler, descBlock);
                }
                for (const tex of shader.textures) {
                    applyBinding(lg, descriptorId, tex, descBlock);
                }
                for (const subpassInput of shader.subpassInputs) {
                    applyBinding(lg, descriptorId, subpassInput, descBlock);
                }
            }
        }
    }
}

export function replacePerBatchOrInstanceShaderInfo (lg: LayoutGraphData,
    asset: EffectAsset, stageName: string) {
    const stageID = lg.locateChild(lg.nullVertex(), stageName);
    let phaseName;
    for (let i = 0; i < asset.techniques.length; ++i) {
        const tech = asset.techniques[i];
        for (let j = 0; j < tech.passes.length; ++j) {
            const pass = tech.passes[j];
            const passPhase = pass.phase;
            if (phaseName && phaseName === `${stageName}_` && !passPhase) {
                continue;
            }
            if (passPhase === undefined) {
                phaseName = `${stageName}_`;
            } else if (typeof passPhase === 'number') {
                phaseName = passPhase.toString();
            } else {
                phaseName = passPhase;
            }
            const phaseID = lg.locateChild(stageID, phaseName);
            if (phaseID === 0xFFFFFFFF) { continue; }
            const phaseData = lg.getRenderPhase(phaseID);
            const shaderID = phaseData.shaderIndex.get(pass.program);
            const shader = asset.shaders.find((val) => val.name === pass.program)!;
            if (shaderID) {
                const shaderData = phaseData.shaderPrograms[shaderID];
                updateShaderBinding(lg, shaderData, shader);
            }
        }
    }
}
