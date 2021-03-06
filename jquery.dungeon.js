(function($) {

	var maps = {};
	var canvasIndex = 0;
	var defaults = {
		'width' : 640,
		'height' : 480,
		'debug' : false,
		'url' : null,
		'drawType' : 'normal',
		'moveType' : 'normal',
		'events' : {}
	};

	function convertToMap(data) {
		var mapData = [];
		var lines = data.split("\n");
		var yLen = lines.length;
		var xLen = 0;
		for (var y = 0; y < yLen; y++) {
			var xData = lines[y];
			if (xLen < xData.length) {
				xLen = xData.length;
			}
		}
		var mapSize = xLen < yLen ? yLen : xLen;
		var x, y, c;
		for (y = 0; y < yLen; y++) {
			var xData = lines[y];
			for (x = 0; x < xData.length; x++) {
				mapData[y * mapSize + x] = xData.substr(x, 1);
			}
			for (; x < mapSize; x++) {
				mapData[y * mapSize + x] = MAP_TYPE_WALL;
			}
		}
		for (; y < mapSize; y++) {
			for (x = 0; x < mapSize; x++) {
				mapData[y * mapSize + x] = MAP_TYPE_WALL;
			}
		}
		return {
			size : mapSize,
			map : mapData
		};
	}

	var methods = {
		
		'init': function(options) {
			var opts = $.extend(true, {}, defaults, options);
			return this.each(function() {
				var $this = $(this);
				var map3d;
				var id = $this.data('mapId');
				var data, map;
				var c;
				if (id) {
					$('#' + id).remove();
					delete maps[id];
				}
				c = $('<canvas />');
				do {
					id = 'dungeon_' + canvasIndex++;
				} while ($('#' + id).size() > 0);
				c.attr('id', id);
				c.attr('tabindex', 0);
				c.attr('width', opts.width);
				c.attr('height', opts.height);
				c.hide();
				map3d = new Map3D(id);
				map3d.isDebug = opts.debug;
				map3d.events = opts.events;
				map3d.setDrawType(opts.drawType);
				map3d.setMoveType(opts.moveType);
				map3d.setColor(opts.color);
				maps[id] = map3d;
				$this.data('mapId', id);
				if (opts.url) {
					$this.append(c);
					map3d.init();
					$.ajax({
						'url': opts.url,
						'mimeType': 'text/plain',
						'dataType': 'text',
						'success': function(data) {
							map = convertToMap(data);
							map3d.loadMap(map.size, map.map);
							c.fadeIn('fast');
						}
					});
				} else {
					$this.after(c);
					map3d.init();
					map = convertToMap($this.val());
					map3d.loadMap(map.size, map.map);
					c.fadeIn('fast');
				}
			});
		},

		'loadMap': function(url, opts) {
			opts = $.extend({
				'start': MAP_TYPE_START,
				'noResume': false
			}, opts);
			var that = this;
			$.ajax({
				'url': url,
				'mimeType': 'text/plain',
				'dataType': 'text',
				'success': function(data) {
					var map = convertToMap(data);
					that.each(function() {
						var $this = $(this);
						var m, id = $this.data('mapId');
						if (id && (m = maps[id])) {
							m.loadMap(map.size, map.map, opts.start);
							if (! opts.noResume) { m.resume(); }
						}
					});
				}
			});
			return this;
		},

		'drawType': function(type) {
			return this.each(function() {
				var $this = $(this);
				var m, id = $this.data('mapId');
				if (id && (m = maps[id])) {
					m.setDrawType(type);
				}
			});
		},

		'moveType': function(type) {
			return this.each(function() {
				var $this = $(this);
				var m, id = $this.data('mapId');
				if (id && (m = maps[id])) {
					m.setMoveType(type);
				}
			});
		}

	};

	$.fn.dungeon = function(method) {
		if (methods[method]) {
			return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
		}
		else if (typeof method === 'object' || ! method) {
			return methods.init.apply(this, arguments);
		}
		else {
			$.error('jQuery.dungeon: Method does not exists');
		}

	};

	// 定数
	var MAP_TYPE_WAY = ' ';
	var MAP_TYPE_WALL = '*';
	var MAP_TYPE_START = '0';

	function Map3D(_id) {

		var thisMap = this;

		// キャンバス情報
		this.cnvId = _id;
		this.cnv = null;
		this.canvasWidth = 0;
		this.canvasHeight = 0;
		this.canvasLeft = 0;
		this.canvasTop = 0;
		this.aspect = 0;
		this.ctx = null;
		this.canvasCache = {};

		// マップ
		this.map = Array();
		this.mapSize = 0;
		this.mapLoaded = false;
		// マップの１ブロックサイズ
		this.chipSize = 20;

		// クリップ
		this.chipSizeTh = 0;
		this.clipLeftX = 0;
		this.clipLeftY = 0;
		this.clipRightX = 0;
		this.clipRightY = 0;
		this.clipFar = 0;
		this.clipNear = 0;
		this.eyeX = 0;
		this.eyeY = 0;
		this.perspective = 0;

		// BSPソート関連
		this.visibleObjects = null;

		// 描画制御
		this.fps = 20;
		this.idleLoop = null;
		this.is3D = true;
		this.isDebug = true;

		this.currentMoveType = 'normal';
		this.updateViewer = updateViewerNormal;

		this.currentDrawType = 'normal';
		this.drawGroundImpl = drawGroundNormal;
		this.drawWallColorImpl = drawWallColorNormal;
		this.drawWallImpl = drawWallNormal;

		this.color = {
			'wall' : [255,255,255],
			'ceiling' : [170,170,170],
			'floor' : [187,170,170]
		};

		// 操作
		this.pressedKeyUp = false;
		this.pressedKeyDown = false;
		this.pressedKeyLeft = false;
		this.pressedKeyRight = false;
		this.mouseStartX = -1;
		this.mouseStartY = -1;
		this.mouseDragging = false;

		// 視点
		this.yourX = -1;
		this.yourY = -1;
		this.yourAngle = 0;
		this.yourFovxh = Math.PI * 60 / 180 / 2;
		this.manHeight = 1.7;
		// 視点スピード[m/s]
		this.yourSpeed = 40;
		this.yourRotateSpeed = 10 * Math.PI / 180;

		this.events = {};
		this.prePosition = null;
		this.preData;

		this.bindKeyFlag = false;

		// キャンバス初期化
		this.init = function() {
			this.cnv = document.getElementById(this.cnvId);
			if (this.cnv.getContext) {
				this.canvasWidth = this.cnv.width;
				this.canvasHeight = this.cnv.height;
				this.aspect = this.canvasWidth / this.canvasHeight;
				this.centerX = this.canvasWidth / 2;
				this.centerY = this.canvasHeight / 2;
				this.canvasLeft = this.cnv.offsetLeft;
				this.canvasTop = this.cnv.offsetTop;
				this.ctx = this.cnv.getContext('2d');
				this.ctx.fillStyle = 'rgb(0,0,0)';
				this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

				this.bindKey();
			}
			this.initMap();
		};

		this.initMap = function() {
			this.chipSizeTh = this.chipSize * Math.SQRT2 / 2;
			this.clipFar = 400;
			this.clipNear = 0.5;
			this.perspective = this.canvasWidth / 2 / Math.tan(this.yourFovxh);
		};

		this.loadMap = function(size, map, pos) {
			if (! pos) { pos = MAP_TYPE_START; }
			this.prePosition = null;
			this.canvasCache = {};
			this.mapSize = size;
			this.map = map;
			for (var y = 0, ny = this.mapSize; y < ny; y++) {
				for (var x = 0, nx = this.mapSize; x < nx; x++) {
					if (this.map[y * this.mapSize + x] == pos) {
						this.updateEvents(x, y);
						this.yourX = x + 0.5;
						this.yourY = y + 0.5;
					}
				}
			}
			this.updateClip();
			this.mapLoaded = true;
			this.bindLoop();
		};

		// クリップラインの算出
		this.updateClip = function() {
			var clipAngle = this.yourAngle - this.yourFovxh;
			this.clipLeftX = Math.cos(clipAngle);
			this.clipLeftY = Math.sin(clipAngle);
			clipAngle = this.yourAngle + this.yourFovxh;
			this.clipRightX = Math.cos(clipAngle);
			this.clipRightY = Math.sin(clipAngle);
			// 視線
			this.eyeX = Math.cos(this.yourAngle);
			this.eyeY = Math.sin(this.yourAngle);
		};

		// オクルージョンカリング
		this.occlusionCulling = function(_px, _py, _direction, _x, _y, _array,
				_index) {

			switch (_direction) {
			case 0: // west
				var west = _x * this.chipSize;
				if (west < _px) {
					// 見えない
					return;
				}
				var farNorth = 0;
				for (var j = _y; 0 <= j; j--) {
					if (this.map[j * this.mapSize + _x] == 1) {
						farNorth = j * this.chipSize;
					} else {
						break;
					}
				}
				var farSouth = 0;
				for (var j = _y; j < this.mapSize; j++) {
					if (this.map[j * this.mapSize + _x] == 1) {
						farSouth = (j + 1) * this.chipSize;
					} else {
						break;
					}
				}
				lx = west - _px;
				ly = farNorth - _py;
				rx = west - _px;
				ry = farSouth - _py;
				break;
			case 1: // east
				var east = (_x + 1) * this.chipSize;
				if (_px < east) {
					return;
				}
				var farNorth = 0;
				for (var j = _y; 0 <= j; j--) {
					if (this.map[j * this.mapSize + _x] == 1) {
						farNorth = j * this.chipSize;
					} else {
						break;
					}
				}
				var farSouth = 0;
				for (var j = _y; j < this.mapSize; j++) {
					if (this.map[j * this.mapSize + _x] == 1) {
						farSouth = (j + 1) * this.chipSize;
					} else {
						break;
					}
				}
				lx = east - _px;
				ly = farSouth - _py;
				rx = east - _px;
				ry = farNorth - _py;
				break;
			case 2: // sourth
				var south = (_y + 1) * this.chipSize;
				if (_py < south) {
					return;
				}
				var farWest = 0;
				for (var j = _x; 0 <= j; j--) {
					if (this.map[_y * this.mapSize + j] == 1) {
						farWest = j * this.chipSize;
					} else {
						break;
					}
				}
				var farEast = 0;
				for (var j = _x; j < this.mapSize; j++) {
					if (this.map[_y * this.mapSize + j] == 1) {
						farEast = (j + 1) * this.chipSize;
					} else {
						break;
					}
				}
				lx = farWest - _px;
				ly = south - _py;
				rx = farEast - _px;
				ry = south - _py;
				break;
			case 3: // nouth
				var north = _y * this.chipSize;
				if (north < _py) {
					return;
				}
				var farWest = 0;
				for (var j = _x; 0 <= j; j--) {
					if (this.map[_y * this.mapSize + j] == 1) {
						farWest = j * this.chipSize;
					} else {
						break;
					}
				}
				var farEast = 0;
				for (var j = _x; j < this.mapSize; j++) {
					if (this.map[_y * this.mapSize + j] == 1) {
						farEast = (j + 1) * this.chipSize;
					} else {
						break;
					}
				}
				lx = farEast - _px;
				ly = north - _py;
				rx = farWest - _px;
				ry = north - _py;
				break;
			}

			var llen = Math.sqrt(lx * lx + ly * ly);
			var rlen = Math.sqrt(rx * rx + ry * ry);
			if (llen != 0 && rlen != 0) {
				lx /= llen;
				ly /= llen;
				rx /= rlen;
				ry /= rlen;

				switch (_direction) {

				case 0: // west
					for (var i = _index; i < _array.length; i++) {
						var block = _array[i];
						var x = block['x'];
						var y = block['y'];
						if (block['v'] && _x < x) {
							var xx = (x + 0.5) * this.chipSize;
							var yy = (y + 0.5) * this.chipSize;
							var vx = xx - _px;
							var vy = yy - _py;
							if (this.chipSizeTh < (vx * ry - vy * rx)
									&& this.chipSizeTh < (-vx * ly + vy * lx)) {
								block['v'] = false;
								_array[i] = block;
							}
						}
					}
					break;

				case 1: // east
					for (var i = _index; i < _array.length; i++) {
						var block = _array[i];
						var x = block['x'];
						var y = block['y'];
						if (block['v'] && x < _x) {
							var xx = (x + 0.5) * this.chipSize;
							var yy = (y + 0.5) * this.chipSize;
							var vx = xx - _px;
							var vy = yy - _py;
							if (this.chipSizeTh < (vx * ry - vy * rx)
									&& this.chipSizeTh < (-vx * ly + vy * lx)) {
								block['v'] = false;
								_array[i] = block;
							}
						}
					}
					break;

				case 2: // south
					for (var i = _index; i < _array.length; i++) {
						var block = _array[i];
						var x = block['x'];
						var y = block['y'];
						if (block['v'] && y < _y) {
							var xx = (x + 0.5) * this.chipSize;
							var yy = (y + 0.5) * this.chipSize;
							var vx = xx - _px;
							var vy = yy - _py;
							if (this.chipSizeTh < (vx * ry - vy * rx)
									&& this.chipSizeTh < (-vx * ly + vy * lx)) {
								block['v'] = false;
								_array[i] = block;
							}
						}
					}
					break;

				case 3: // north
					for (var i = _index; i < _array.length; i++) {
						var block = _array[i];
						var x = block['x'];
						var y = block['y'];
						if (block['v'] && _y < y) {
							var xx = (x + 0.5) * this.chipSize;
							var yy = (y + 0.5) * this.chipSize;
							var vx = xx - _px;
							var vy = yy - _py;
							if (this.chipSizeTh < (vx * ry - vy * rx)
									&& this.chipSizeTh < (-vx * ly + vy * lx)) {
								block['v'] = false;
								_array[i] = block;
							}
						}
					}
					break;

				}

			}
		};

		// 奥行き並べ替え(昇順)
		this.zSortAsc = function(_left, _right) {
			return (_left.z - _right.z);
		};

		// BSPソート
		this.sortBSP = function(_array) {
			var pivot = 0;
			var obj = null;
			for (; pivot < _array.length; pivot++) {
				var o = _array[pivot];
				if (o.type < 4) {
					// 壁ならば
					obj = o;
					break;
				}
			}

			if (obj == null) {
				return _array;
			}

			var left = Array();
			var center = Array();
			var right = Array();

			var type = obj.type;
			var pivotX = obj.x - this.yourX;
			var pivotY = obj.y - this.yourY;
			center.push(obj);

			for (var i = 0; i < _array.length; i++) {
				if (i != pivot) {
					obj = _array[i];
					switch (type) {

					case 0: // west
						var x = obj.x - this.yourX;
						if (obj.type == 0 && pivotX == x) {
							center.push(obj);
						} else if (pivotX != 0 && 1 <= x / pivotX) {
							left.push(obj);
						} else {
							right.push(obj);
						}
						break;
					case 1: // east
						var x = obj.x - this.yourX;
						if (3 < obj.type) {
							// 壁以外なら
							if (pivotX != -1 && 1 < x / (pivotX + 1)) {
								left.push(obj);
							} else {
								right.push(obj);
							}
						} else {
							if (obj.type == 1 && pivotX == x) {
								center.push(obj);
							} else if (pivotX != 0 && 1 <= x / pivotX) {
								left.push(obj);
							} else {
								right.push(obj);
							}
						}
						break;
					case 2: // south
						var y = obj.y - this.yourY;
						if (3 < obj.type) {
							// 壁以外なら
							if (pivotY != -1 && 1 < y / (pivotY + 1)) {
								left.push(obj);
							} else {
								right.push(obj);
							}
						} else {
							if (obj.type == 2 && pivotY == y) {
								center.push(obj);
							} else if (pivotY != 0 && 1 <= y / pivotY) {
								left.push(obj);
							} else {
								right.push(obj);
							}
						}
						break;
					case 3: // north
						var y = obj.y - this.yourY;
						if (obj.type == 3 && pivotY == y) {
							center.push(obj);
						} else if (pivotY != 0 && 1 <= y / pivotY) {
							left.push(obj);
						} else {
							right.push(obj);
						}
						break;
					}
				}
			}
			if (1 < left.length) {
				left = this.sortBSP(left);
			}
			if (1 < right.length) {
				right = this.sortBSP(right);
			}
			return (left.concat(center)).concat(right);
		};

		this.setMoveType = function(type) {
			switch (type) {
				case 'snap':
				case 'grid':
				case 'wiz':
				case 'wizardry':
					this.yourX = 0.5 + Math.floor(this.yourX);
					this.yourY = 0.5 + Math.floor(this.yourY);
					this.yourAngle = (Math.PI / 2) * Math.round(this.yourAngle / (Math.PI / 2));
					this.updateClip();
					this.currentMoveType = 'grid';
					this.updateViewer = updateViewerGrid;
					break;	
				case 'normal':
				case 'smooth':
				default:
					this.currentMoveType = 'normal';
					this.updateViewer = updateViewerNormal;
					break;
			}
		};

		this.setDrawType = function(type) {
			switch (type) {
				case 'wire':
				case 'wireframe':
				case 'wiz':
				case 'wizardry':
					this.currentDrawType = 'wireframe';
					this.drawGroundImpl = drawGroundWire;
					this.drawWallColorImpl = drawWallColorWire;
					this.drawWallImpl = drawWallWire;
					break;	
				case 'normal':
				default:
					this.currentDrawType = 'normal';
					this.drawGroundImpl = drawGroundNormal;
					this.drawWallColorImpl = drawWallColorNormal;
					this.drawWallImpl = drawWallNormal;
					break;
			}
		};

		this.drawGround = function() {
			this.drawGroundImpl();
			this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
		};

		this.drawWall = function(_px, _py, _sx, _sy, _ex, _ey) {

			var wallHeight = 10.0;

			var fxx = _sx - _px;
			var fyy = _sy - _py;

			var fdepth = this.eyeX * fxx + this.eyeY * fyy;

			var sxx = _ex - _px;
			var syy = _ey - _py;

			var sdepth = this.eyeX * sxx + this.eyeY * syy;

			if (this.clipNear < fdepth || this.clipNear < sdepth) {
				if (fdepth < this.clipNear) {
					var vx = _ex - _sx;
					var vy = _ey - _sy;
					var delta = this.clipNear - fdepth;
					var len = sdepth - fdepth;
					_sx += vx * (delta / len);
					_sy += vy * (delta / len);
					fxx = _sx - _px;
					fyy = _sy - _py;
					fdepth = this.eyeX * fxx + this.eyeY * fyy;
				} else if (sdepth < this.clipNear) {
					var vx = _sx - _ex;
					var vy = _sy - _ey;
					var delta = this.clipNear - sdepth;
					var len = fdepth - sdepth;
					_ex += vx * (delta / len);
					_ey += vy * (delta / len);
					sxx = _ex - _px;
					syy = _ey - _py;
					sdepth = this.eyeX * sxx + this.eyeY * syy;
				}

				var scale = this.perspective / fdepth;
				var pos = fxx * this.eyeY - fyy * this.eyeX;
				var fx = this.centerX - pos * scale;
				var fby = this.centerY + this.manHeight * scale;
				var fty = this.centerY + (this.manHeight - wallHeight) * scale;

				scale = this.perspective / sdepth;
				pos = sxx * this.eyeY - syy * this.eyeX;
				var sx = this.centerX - pos * scale;
				var sty = this.centerY + (this.manHeight - wallHeight) * scale;
				var sby = this.centerY + this.manHeight * scale;
				
				this.drawWallColorImpl(fx, sx, fdepth, sdepth);

				this.ctx.beginPath();
				this.ctx.moveTo(fx, fby);
				this.ctx.lineTo(fx, fty);
				this.ctx.lineTo(sx, sty);
				this.ctx.lineTo(sx, sby);
				this.ctx.closePath();

				this.drawWallImpl();
			}
		};

		this.culling = function() {
			// プレイヤー位置
			var px = this.yourX * this.chipSize;
			var py = this.yourY * this.chipSize;

			var renderingBlocks = Array();

			// 視野カリング
			for (var y = 0; y < this.mapSize; y++) {
				var yy = (y + 0.5) * this.chipSize;
				var vy = yy - py;
				if (Math.abs(vy) < this.clipFar + this.chipSizeTh) {
					for (var x = 0; x < this.mapSize; x++) {
						var xx = (x + 0.5) * this.chipSize;
						var vx = xx - px;
						if (Math.abs(vx) < this.clipFar + this.chipSizeTh) {
							var len = vx * vx + vy * vy;
							if (len < this.clipFar * this.clipFar && this.isWall(x, y)) {
								if (-this.chipSizeTh < (vx * this.clipRightY - vy * this.clipRightX)
										&& -this.chipSizeTh < (-vx * this.clipLeftY + vy * this.clipLeftX)) {
									var block = new Object();
									block['x'] = x;
									block['y'] = y;
									block['z'] = Math.sqrt(len);
									block['v'] = true;
									renderingBlocks.push(block);
								}
							}
						}
					}
				}
			}

			renderingBlocks.sort(this.zSortAsc);
			for (var i = 0; i < renderingBlocks.length; i++) {
				var block = renderingBlocks[i];
				if (block['v']) {

					var x = block['x'];
					var y = block['y'];

					// 西の壁
					this.occlusionCulling(px, py, 0, x, y, renderingBlocks,
							i + 1);
					// 東の壁
					this.occlusionCulling(px, py, 1, x, y, renderingBlocks,
							i + 1);
					// 南の壁
					this.occlusionCulling(px, py, 2, x, y, renderingBlocks,
							i + 1);
					// 北の壁
					this.occlusionCulling(px, py, 3, x, y, renderingBlocks,
							i + 1);

				}
			}

			for (var i = 0; i < renderingBlocks.length; i++) {
				var block = renderingBlocks[i];
				if (block['v']) {
					var x = block['x'];
					var y = block['y'];

					var west = x * this.chipSize;
					var east = (x + 1) * this.chipSize;
					var north = y * this.chipSize;
					var south = (y + 1) * this.chipSize;

					if (px < west && x != 0 && ! this.isWall(x - 1, y)) {
						// 西の壁
						var wall = new Object();
						wall.sx = west;
						wall.sy = south;
						wall.ex = west;
						wall.ey = north;
						wall.x = x;
						wall.y = y;
						wall.type = 0;
						this.visibleObjects.push(wall);
					}
					if (east < px && x != this.mapSize - 1 && ! this.isWall(x + 1, y)) {
						// 東の壁
						var wall = new Object();
						wall.sx = east;
						wall.sy = south;
						wall.ex = east;
						wall.ey = north;
						wall.x = x;
						wall.y = y;
						wall.type = 1;
						this.visibleObjects.push(wall);
					}
					if (south < py && y != this.mapSize - 1 && ! this.isWall(x, y + 1)) {
						// 南の壁
						var wall = new Object();
						wall.sx = west;
						wall.sy = south;
						wall.ex = east;
						wall.ey = south;
						wall.x = x;
						wall.y = y;
						wall.type = 2;
						this.visibleObjects.push(wall);
					}
					if (py < north && y != 0 && ! this.isWall(x, y - 1)) {
						// 北の壁
						var wall = new Object();
						wall.sx = west;
						wall.sy = north;
						wall.ex = east;
						wall.ey = north;
						wall.x = x;
						wall.y = y;
						wall.type = 3;
						this.visibleObjects.push(wall);
					}
				}
			}

		};

		// 描画
		this.draw = function() {
			this.is3D ? this.draw3d() : this.draw2d();
		};

		// 3D描画
		this.draw3d = function() {
			if (this.ctx != null) {

				this.updateViewer();
				this.visibleObjects = Array();
				
				this.drawGround();
				this.culling();
				if (0 < this.visibleObjects.length) {
					this.visibleObjects = this.sortBSP(this.visibleObjects);
				}

				var px = this.yourX * this.chipSize;
				var py = this.yourY * this.chipSize;

				for (var i = 0; i < this.visibleObjects.length; i++) {
					var obj = this.visibleObjects[i];
					switch (obj.type) {
					case 0:
					case 1:
					case 2:
					case 3:
						// 壁描画
						this.drawWall(px, py, obj.sx, obj.sy, obj.ex, obj.ey);
						break;
					}
				}

			}
		};

		// 2D描画
		this.draw2d = function() {

			if (this.ctx != null) {

				this.updateViewer();
				if (this.isDebug) {
					this.visibleObjects = Array();
					this.culling();
					if (0 < this.visibleObjects.length) {
						this.visibleObjects = this.sortBSP(this.visibleObjects);
					}
				}

				var renderingCanvasSize = (this.canvasWidth < this.canvasHeight ? this.canvasWidth : this.canvasHeight);
				var renderingSize = renderingCanvasSize / this.mapSize;
				var renderingFar = this.clipFar * renderingSize / this.chipSize;
				var offsetX = (this.canvasWidth - renderingCanvasSize) / 2;
				var offsetY = (this.canvasHeight - renderingCanvasSize) / 2;
				var px = this.yourX * renderingSize + offsetX;
				var py = this.yourY * renderingSize + offsetY;

				if (! this.drawCache('Map2D')) {
					this.ctx.fillStyle = "rgb(0, 0, 0)";
					this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
					for (var y = 0; y < this.mapSize; y++) {
						for (var x = 0; x < this.mapSize; x++) {
							var value = this.map[y * this.mapSize + x];
							switch (value) {
							case MAP_TYPE_WAY:
								this.ctx.fillStyle = 'rgb(255,255,255)';
								this.ctx.fillRect(x * renderingSize + offsetX, y
										* renderingSize + offsetY, renderingSize,
										renderingSize);
								break;
							case MAP_TYPE_START:
								this.ctx.fillStyle = 'rgb(0,0,255)';
								this.ctx.fillRect(x * renderingSize + offsetX, y
										* renderingSize + offsetY, renderingSize,
										renderingSize);
								break;
							case MAP_TYPE_WALL:
								break;
							default:
								this.ctx.fillStyle = 'rgb(0,255,0)';
								this.ctx.fillRect(x * renderingSize + offsetX,
										y * renderingSize + offsetY,
										renderingSize, renderingSize);
							}
						}
					}
					this.saveCache('Map2D');
				}

				if (this.isDebug) {
					this.ctx.strokeStyle = 'rgb(255,0,0)';
					this.ctx.lineWidth = 3;
					for (var i = 0; i < this.visibleObjects.length; i++) {
						var obj = this.visibleObjects[i];
						var sx, sy, ex, ey;
						var x = obj.x;
						var y = obj.y;
						switch (obj.type) {
						case 0:
							sx = x * renderingSize + offsetX;
							ex = sx;
							sy = y * renderingSize + offsetY;
							ey = (y + 1) * renderingSize + offsetY;
							break;
						case 1:
							sx = (x + 1) * renderingSize + offsetX;
							ex = sx;
							sy = y * renderingSize + offsetY;
							ey = (y + 1) * renderingSize + offsetY;
							break;
						case 2:
							sx = x * renderingSize + offsetX;
							ex = (x + 1) * renderingSize + offsetX;
							sy = (y + 1) * renderingSize + offsetY;
							ey = sy;
							break;
						case 3:
							sx = x * renderingSize + offsetX;
							ex = (x + 1) * renderingSize + offsetX;
							sy = y * renderingSize + offsetY;
							ey = sy;
							break;
						}
						this.ctx.beginPath();
						this.ctx.moveTo(sx, sy);
						this.ctx.lineTo(ex, ey);
						this.ctx.closePath();
						this.ctx.stroke();
					}
					this.ctx.lineWidth = 1;
				}

				// プレイヤー
				this.ctx.fillStyle = 'rgb(255,0,0)';
				this.ctx.fillRect(px - renderingSize / 4, py - renderingSize
						/ 4, renderingSize / 2, renderingSize / 2);
				// プレイヤー視界
				this.ctx.strokeStyle = 'rgb(255,0,0)';
				this.ctx.beginPath();
				this.ctx.moveTo(px, py);
				this.ctx.lineTo(px + this.clipLeftX * renderingFar, py
						+ this.clipLeftY * renderingFar);
				this.ctx.lineTo(px + this.clipRightX * renderingFar, py
						+ this.clipRightY * renderingFar);
				this.ctx.lineTo(px, py);
				this.ctx.closePath();
				this.ctx.stroke();

			}
		};

		this.saveCache = function(name) {
			this.canvasCache[name] = this.ctx.getImageData(0, 0, this.canvasWidth, this.canvasHeight); 
		};

		this.loadCache = function(name) {
			return this.canvasCache[name];
		};

		this.drawCache = function(name) {
			var cache = this.loadCache(name);
			if (cache) {
				this.ctx.putImageData(cache, 0, 0);
			}
			return cache;
		};

		this.updateEvents = function(px, py) {
			var position = py * this.mapSize + px;
			var data = this.map[position];
			if (this.prePosition !== null && this.prePosition != position) {
				this.fire('leave', this.preData);
				this.fire('enter', data);
			}
			this.fire('over', data);
			this.preData = data;
			this.prePosition = position;
		};

		this.fire = function(event, data) {
			if (this.events[event]) {
				this.events[event](this, data);
			}
		};

		// 操作、キー押下
		this.keyDown = function(_event) {
			switch (thisMap.checkKey(_event, true)) {
			case 32: // space
				thisMap.is3D = !thisMap.is3D;
				break;
			}
			return false;
		};

		this.keyUp = function(_event) {
			thisMap.checkKey(_event, false);
		};

		this.checkKey = function(_event, _on) {
			var key = window.event ? window.event.keyCode : _event.keyCode;
			switch (key) {
			case 37: // left
				thisMap.pressedKeyLeft = _on;
				break;
			case 39: // right
				thisMap.pressedKeyRight = _on;
				break;
			case 38: // up
				thisMap.pressedKeyUp = _on;
				break;
			case 40: // down
				thisMap.pressedKeyDown = _on;
				break;
			}
			return key;
		};

		this.clearKey = function() {
			thisMap.pressedKeyLeft = false;
			thisMap.pressedKeyRight = false;
			thisMap.pressedKeyUp = false;
			thisMap.pressedKeyDown = false;
		};

		this.bindLoop = function() {
			if (this.idleLoop == null) {
				this.idleLoop = setInterval(function() {
					thisMap.draw();
				}, 1000 / this.fps);
			}
		};

		this.unbindLoop = function() {
			if (this.idleLoop != null) {
				clearInterval(this.idleLoop);
				this.idleLoop = null;
			}
		};

		this.bindKey = function() {
			if (!this.bindKeyFlag) {
				this.bindKeyFlag = true;
				this.cnv.onkeydown = this.keyDown;
				this.cnv.onkeyup = this.keyUp;
				this.cnv.onmousedown = this.mouseDown;
				this.cnv.onmouseup = this.mouseUp;
				this.cnv.onmousemove = this.mouseMove;
				this.clearKey();
			}
		};

		this.mouseDown = function(_ev) {
			thisMap.mouseDragging = true;
			thisMap.mouseStartX = _ev.offsetX;
			thisMap.mouseStartY = _ev.offsetY;
		};

		this.mouseMove = function(_ev) {
			if (thisMap.currentMoveType == 'normal' && thisMap.mouseDragging) {
				var x = _ev.offsetX;
				var y = _ev.offsetY;
				var dX = x - thisMap.mouseStartX;
				var dY = y - thisMap.mouseStartY;
				thisMap.yourAngle += dX * 0.5 * Math.PI / 180;
				thisMap.yourAngle += dY * 0.5 * Math.PI / 180;
				thisMap.updateClip();
				thisMap.mouseStartX = x;
				thisMap.mouseStartY = y;
			}
		};

		this.mouseUp = function(_ev) {
			thisMap.mouseDragging = false;
		};

		this.unbindKey = function() {
			if (this.bindKeyFlag) {
				this.cnv.onkeydown = null;
				this.cnv.onkeyup = null;
				this.cnv.onmousedown = null;
				this.cnv.onmouseup = null;
				this.cnv.onmousemove = null;
				this.clearKey();
				this.bindKeyFlag = false;
			}
		};

		this.suspend = function() {
			this.mouseDragging = false;
			this.unbindLoop();
			this.unbindKey();
		}

		this.resume = function() {
			thisMap.bindKey();
			thisMap.bindLoop();
		};

		this.isWall = function(x, y) {
			return this.map[y * this.mapSize + x] == MAP_TYPE_WALL;
		};

		this.colorCeiling = function() {
			return 'rgb(' + this.color.ceiling[0] + ',' + this.color.ceiling[1] + ',' + this.color.ceiling[2] + ')';
		};

		this.colorFloor = function() {
			return 'rgb(' + this.color.floor[0] + ',' + this.color.floor[1] + ',' + this.color.floor[2] + ')';
		};

		this.colorWall = function(f) {
			return 'rgb(' + Math.round(this.color.wall[0] * f) + ',' + Math.round(this.color.wall[1] * f) + ',' + Math.round(this.color.wall[2] * f) + ')';
		};

		this.setColor = function(color) {
			if (color) {
				if (Array.isArray(color)) {
					var c = 0xaa / 0xff;
					var f = 0xbb / 0xff;
					this.color = {
						'wall' : color,
						'ceiling' : [Math.round(color[0] * c), Math.round(color[1] * c), Math.round(color[2] * c)],
						'floor' : [Math.round(color[0] * f), Math.round(color[1] * f), Math.round(color[2] * f)]
					};
				}
				else {
					if (Array.isArray(color.ceiling)) { this.color.ceiling = color.ceiling; }
					if (Array.isArray(color.floor)) { this.color.floor = color.floor; }
					if (Array.isArray(color.wall)) { this.color.wall = color.wall; }
				}
			}
		};

		function drawGroundNormal() {
			var grad = this.ctx.createLinearGradient(0, 0, 0, this.canvasHeight);
			grad.addColorStop(0, this.colorCeiling());
			grad.addColorStop(0.5, '#000');
			grad.addColorStop(1, this.colorFloor());
			this.ctx.fillStyle = grad;
		}

		function drawGroundWire() {
			this.ctx.fillStyle = "rgb(0, 0, 0)";
		}

		function drawWallColorNormal(fx, sx, fdepth, sdepth) {
			var fcol = 1 - (fdepth - this.clipNear) / (this.clipFar - this.clipNear);
			var scol = 1 - (sdepth - this.clipNear) / (this.clipFar - this.clipNear);
			var grad = this.ctx.createLinearGradient(fx, 0, sx, 0);
			grad.addColorStop(0, this.colorWall(fcol));
			grad.addColorStop(1, this.colorWall(scol));
			this.ctx.fillStyle = grad;
		}

		function drawWallColorWire(fx, sx, fdepth, sdepth) {
			this.ctx.fillStyle = 'rgb(0,0,0)';
			this.ctx.strokeStyle = 'rgb(255,255,255)';
		}

		function drawWallNormal() {
			this.ctx.fill();
		}

		function drawWallWire() {
			this.ctx.fill();
			this.ctx.stroke();
		}

		function updateViewerNormal() {
			var nX = 0;
			var nY = 0;
			var px = 0;
			var py = 0;
			if (this.pressedKeyLeft) {
				this.yourAngle -= this.yourRotateSpeed;
				this.updateClip();
			}
			if (this.pressedKeyRight) {
				this.yourAngle += this.yourRotateSpeed;
				this.updateClip();
			}
			if (this.pressedKeyUp || this.pressedKeyDown) {
				var speed = this.yourSpeed / this.fps / this.chipSize;
				var forward = this.pressedKeyUp ? 1 : -1;
				nX = this.yourX + speed * this.eyeX * forward;
				nY = this.yourY + speed * this.eyeY * forward;
				px = Math.floor(nX);
				py = Math.floor(nY);
				if (! this.isWall(px, py)) {
					var cx = nX % 1;
					var cy = nY % 1;
					if (cx < 0.1 && this.isWall(px - 1, py)) {
						nX = Math.floor(nX) + 0.1;
					}
					if (0.9 < cx && this.isWall(px + 1, py)) {
						nX = Math.floor(nX) + 0.9;
					}
					if (cy < 0.1 && this.isWall(px, py - 1)) {
						nY = Math.floor(nY) + 0.1;
					}
					if (0.9 < cy && this.isWall(px, py + 1)) {
						nY = Math.floor(nY) + 0.9;
					}
					this.yourX = nX;
					this.yourY = nY;
					this.updateEvents(px, py);
				}
			}
		}

		function updateViewerGrid() {
			var nX = 0;
			var nY = 0;
			var px = 0;
			var py = 0;
			var rot = Math.PI / 2;
			if (this.pressedKeyLeft) {
				this.pressedKeyLeft = false;
				this.yourAngle -= rot; 
				this.updateClip();
			}
			if (this.pressedKeyRight) {
				this.pressedKeyRight = false;
				this.yourAngle += rot;
				this.updateClip();
			}
			if (this.pressedKeyDown) {
				this.pressedKeyDown = false;
				this.yourAngle += Math.PI;
				this.updateClip();
			}
			if (this.pressedKeyUp) {
				this.pressedKeyUp = false;
				nX = this.yourX + this.eyeX;
				nY = this.yourY + this.eyeY;
				px = Math.floor(nX);
				py = Math.floor(nY);
				if (! this.isWall(px, py)) {
					this.yourX = nX;
					this.yourY = nY;
					this.updateEvents(px, py);
				}
			}
		}

	}

})(jQuery);
