const game_screen = document.getElementById("game_screen");
const renderer = new THREE.WebGLRenderer( {canvas: game_screen} );
renderer.setSize(window.innerWidth, window.innerHeight);
var camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
var scene = new THREE.Scene();
scene.add(camera);
var model;
camera.position.set(0, 125, -125);
var mtlLoader = new THREE.MTLLoader();
mtlLoader.setPath('resources/plane_data/');
mtlLoader.load('low_res.mtl', function(materials) {
	materials.preload();
	var objLoader = new THREE.OBJLoader();
	objLoader.setMaterials(materials);
	objLoader.setPath('resources/plane_data/');
	objLoader.load('low_res.obj', function(object) {
		console.log(object);
		scene.add(object);
		camera.lookAt(object);
		renderer.render(scene, camera);
	});
});
/*var objLoader = new THREE.OBJLoader();
objLoader.setPath('resources/plane_data/');
objLoader.load('untitled.obj', function(object) {
		console.log(object);
		scene.add(object);
		camera.lookAt(object);
		renderer.render(scene, camera);
	});*/
var t = new THREE.TextureLoader().load("resources/plane_data/BodyTexture.bmp");
var geo = new THREE.BoxGeometry(20, 20, 20);
var mat = new THREE.MeshBasicMaterial({map:t});
var c = new THREE.Mesh(geo, mat);
//scene.add(c);
const own_material = new THREE.MeshBasicMaterial({
		color: 0x00ff00,
		side : THREE.DoubleSide,
		transparent : true,
		opacity: 0.5
});
window.addEventListener("keydown", function(e) {
	console.log(e.key);
	if (e.key == "x") {
		model.rotateX(0.1);
	}
	if (e.key == "y") {
		model.rotateY(0.1);
	}
	if (e.key == "z") {
		model.rotateZ(0.1);
	}
	console.log(model.rotation);
});
var light = new THREE.AmbientLight(0xffffff, 1);
scene.add(light);
/*var sg = new THREE.SphereGeometry(3, 32, 32);
var sph = new THREE.Mesh(sg, own_material);
scene.add(sph);
sph.position.set(0, 0, 0);
var sph = new THREE.Mesh(sg, own_material);
scene.add(sph);
sph.position.set(-10, 0, 0);
var sph = new THREE.Mesh(sg, own_material);
scene.add(sph);
sph.position.set(10, 0, 0);
var sph = new THREE.Mesh(sg, own_material);
scene.add(sph);
sph.position.set(0, 10, 0);
var sph = new THREE.Mesh(sg, own_material);
scene.add(sph);
sph.position.set(0, 0, 5);*/
var controls = new THREE.OrbitControls( camera );
function animate() {
	requestAnimationFrame( animate );

	// required if controls.enableDamping or controls.autoRotate are set to true
	controls.update();

	renderer.render( scene, camera );

}
animate();
/*const own_material = new THREE.MeshBasicMaterial({
		color: 0x00ff00,
		side : THREE.DoubleSide,
		transparent : true,
		opacity: 0.5
});
const m1 = new THREE.MeshBasicMaterial({
		color: 0xff0000,
		side : THREE.DoubleSide,
		transparent : true,
		opacity: 0.5
});

function get_cd(old_left, old_right, new_left, edge) {
	var v1 = new_left.clone();
	v1.sub(old_left);
	var v2 = old_right.clone();
	v2.sub(old_left);
	var v3 = new THREE.Vector3().crossVectors(v1, v2); // If v1 and v2 are not parallel, then {v1, v2, v3} is a basis of R^3.
	v3.normalize(); // Not necessary
	var matrix = new THREE.Matrix3();
	matrix.set( 
		new_left.x - old_left.x, old_right.x - old_left.x, v3.x,
		new_left.y - old_left.y, old_right.y - old_left.y, v3.y,
		new_left.z - old_left.z, old_right.z - old_left.z, v3.z
	);
	var e1 = new THREE.Vector3(1, 0, 0);
	//e1.applyMatrix3(matrix);
	//console.log(e1, new_left, old_left);
	try {
		matrix = matrix.getInverse(matrix, true);
	}
	catch(e) {
		console.log("Matrix not invertible:", matrix);
	}
	var center = old_left.clone();
	center.addScaledVector(v1, 0.5);
	center.addScaledVector(v2, 0.5);
	var sg = new THREE.SphereGeometry(1, 32, 32);
	var sph = new THREE.Mesh(sg, own_material);
	scene.add(sph);
	sph.position.set(center.x, center.y, center.z);
	var collision_data = {
		matrix: matrix,
		normal: v3,
		point: old_left
	};
	return intersects(collision_data, edge);
}

function intersects(collision_data, edge p1, p2) {
	var p1 = edge.p1;
	var p2 = edge.p2;
	// Find intersection between line passing through "p1" and "p2" and plane given by "collision_data".
	var v = p2.clone();
	v.sub(p1);
	var dp = collision_data.normal.dot(v);
	if (dp == 0) { // Line and plane are parallel.
		return false;
	}
	var tmp_vec = collision_data.point.clone();
	tmp_vec.sub(p1);
	var c = tmp_vec.dot(collision_data.normal) / dp;
	if (c < 0 || c > 1) {
		console.log("c", c);
		//return false;
	}
	// Intersection occurs on line segment connecting "point" to "point" + "v".
	point_of_intersection = v.clone();
	point_of_intersection.multiplyScalar(c);
	point_of_intersection.add(p1);
	var sg = new THREE.SphereGeometry(1, 32, 32);
	var sph = new THREE.Mesh(sg, m1);
	scene.add(sph);
	sph.position.set( point_of_intersection.x, point_of_intersection.y, point_of_intersection.z );
	point_of_intersection.sub(collision_data.point);
	point_of_intersection.applyMatrix3(collision_data.matrix);
	if ( point_of_intersection.x >= 0 && point_of_intersection.x <= 1 && point_of_intersection.y >= 0 && point_of_intersection.y <= 1) {
		console.log(point_of_intersection);
		return true;
	}
	console.log(point_of_intersection);
	return false;
}

function foo() {
	var p1 = new THREE.Vector3(Math.random() * 25, Math.random() * 25, Math.random() * 25);
	var p2 = new THREE.Vector3(Math.random() * 25, Math.random() * 25, Math.random() * 25);
	var p3 = new THREE.Vector3(Math.random() * 25, Math.random() * 25, Math.random() * 25);
	edge = {
		p1: new THREE.Vector3(Math.random() * 25, Math.random() * 25, Math.random() * 25),
		p2: new THREE.Vector3(Math.random() * 25, Math.random() * 25, Math.random() * 25)
	}
	var e1 = new THREE.Vector3(1, 0, 0);
	var e2 = new THREE.Vector3(0, 1, 0);
	var e3 = new THREE.Vector3(0, 0, 1);
	console.log(get_cd(p1, p2, p3, edge));
	var triangleGeometry = new THREE.Geometry();
	triangleGeometry.vertices[0] = p1;
	triangleGeometry.vertices[1] = p2;
	triangleGeometry.vertices[2] = p3;
	var p4 = p2.clone();
	p4.add(p3);
	p4.sub(p1);
	triangleGeometry.vertices[3] = p4;
	triangleGeometry.faces.push( new THREE.Face3(0, 1, 2) );
	triangleGeometry.faces.push( new THREE.Face3(1, 2, 3) );
	var square = new THREE.Mesh(triangleGeometry, own_material);
	scene.add(square);
	var line = new THREE.Geometry();
	line.vertices[0] = edge.p1.clone();
	line.vertices[0].sub(e1);
	line.vertices[1] = edge.p1;
	line.vertices[2] = edge.p2;
	line.vertices[3] = edge.p2.clone();
	line.vertices[3].sub(e1);
	line.faces.push( new THREE.Face3(0, 1, 2) );
	line.faces.push( new THREE.Face3(0, 2, 3) );
	var l = new THREE.Mesh(line, m1);
	scene.add(l);
	renderer.render(scene, camera);
}
foo();

setInterval( function() {
	var theta = Math.random() * Math.PI * 2;
	camera.position.set( 0, 50 * Math.cos(theta), 50 * Math.sin(theta) );
	camera.lookAt(0, 0, 0);
	renderer.render(scene, camera);
}, 1000);*/
