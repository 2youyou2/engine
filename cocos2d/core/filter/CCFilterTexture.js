

/**
 * @author Mat Groves http://matgroves.com/ @Doormat23
 */

/**
* @class FilterTexture
* @constructor
* @param gl {WebGLContext} the current WebGL drawing context
* @param width {Number} the horizontal range of the filter
* @param height {Number} the vertical range of the filter
* @param scaleMode {Number} See {{#crossLink "PIXI/scaleModes:property"}}scaleModes{{/crossLink}} for possible values
*/
function FilterTexture (gl, width, height, nearestMode)
{
    /**
     * @property gl
     * @type WebGLContext
     */
    this.gl = gl;

    // next time to create a frame buffer and texture

    /**
     * @property frameBuffer
     * @type Any
     */
    this.frameBuffer = gl.createFramebuffer();

    /**
     * @property texture
     * @type Any
     */
    this.texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D,  this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearestMode ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearestMode ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var oldFrameBuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

    // required for masking a mask??
    // this.renderBuffer = gl.createRenderbuffer();
    // gl.bindRenderbuffer(gl.RENDERBUFFER, this.renderBuffer);
    // gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.renderBuffer);

    this.resize(width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, oldFrameBuffer);
}

FilterTexture.prototype.constructor = FilterTexture;

/**
* Clears the filter texture.
*
* @method clear
*/
FilterTexture.prototype.clear = function()
{
    var gl = this.gl;

    gl.clearColor(0,0,0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
};

/**
 * Resizes the texture to the specified width and height
 *
 * @method resize
 * @param width {Number} the new width of the texture
 * @param height {Number} the new height of the texture
 */
FilterTexture.prototype.resize = function(width, height)
{
    if(this.width === width && this.height === height) return;

    this.width = width;
    this.height = height;

    var gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D,  this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,  width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // update the stencil buffer width and height
    // gl.bindRenderbuffer(gl.RENDERBUFFER, this.renderBuffer);
    // gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, width , height );
    // 
};

/**
* Destroys the filter texture.
*
* @method destroy
*/
FilterTexture.prototype.destroy = function()
{
    var gl = this.gl;
    gl.deleteFramebuffer( this.frameBuffer );
    gl.deleteTexture( this.texture );

    this.frameBuffer = null;
    this.texture = null;
};

cc.FilterTexture = FilterTexture;
