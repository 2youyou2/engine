/****************************************************************************
 Copyright (c) 2019-2023 Xiamen Yaji Software Co., Ltd.

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

#include "GLES3Std.h"

#include "GLES3Commands.h"
#include "GLES3Device.h"
#include "GLES3Shader.h"
#include "base/std/hash/hash_fwd.hpp"

namespace cc {
namespace gfx {

GLES3Shader::GLES3Shader() {
    _typedID = generateObjectID<decltype(this)>();
}

GLES3Shader::~GLES3Shader() {
    destroy();
}

GLES3GPUShader *GLES3Shader::gpuShader() const {
    return _gpuShader;
}

void GLES3Shader::doInit(const ShaderInfo & /*info*/) {
    _gpuShader = ccnew GLES3GPUShader;
    CC_ASSERT(!_gpuShader->glProgram);
    _gpuShader->name = getName();
    _gpuShader->blocks = getBlocks();
    _gpuShader->buffers = getBuffers();
    _gpuShader->samplerTextures = getSamplerTextures();
    _gpuShader->samplers = getSamplers();
    _gpuShader->textures = getTextures();
    _gpuShader->images = getImages();
    _gpuShader->subpassInputs = getSubpassInputs();
    _gpuShader->hash = getHash();
    for (const auto &stage : getStages()) {
        GLES3GPUShaderStage gpuShaderStage = {stage.stage, stage.source};
        _gpuShader->gpuStages.emplace_back(std::move(gpuShaderStage));
    }
    //for (auto &stage : _stages) {
    //    stage.source.clear();
    //    stage.source.shrink_to_fit();
    //}
}

void GLES3Shader::doCompileGpuShader() {
    if (_gpuShader->glProgram == 0) {
        //auto gpuPipelineLayout = static_cast<GLES3PipelineLayout *>(_pipelineLayout)->gpuPipelineLayout();
        cmdFuncGLES3CreateShader(GLES3Device::getInstance(), _gpuShader, nullptr);
        CC_ASSERT(_gpuShader->glProgram);

        //// Clear shader source after they're uploaded to GPU
        for (auto &stage : _gpuShader->gpuStages) {
            stage.source.clear();
            stage.source.shrink_to_fit();
        }
    }
}

void GLES3Shader::doDestroy() {
    if (_gpuShader) {
        cmdFuncGLES3DestroyShader(GLES3Device::getInstance(), _gpuShader);
        delete _gpuShader;
        _gpuShader = nullptr;
    }
}

} // namespace gfx
} // namespace cc
