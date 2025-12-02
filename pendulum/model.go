package pendulum

// Params 表示双复摆的物理参数：两根有质量的刚性杆
type Params struct {
	// L[i]：第 i 根杆的长度（m），这里只用前两个 L[0], L[1]
	L []float64

	// M[i]：第 i 根杆的质量（kg），均匀分布在杆上，这里用作 m1, m2
	M []float64

	// G：重力加速度（m/s^2），<=0 时默认 9.81
	G float64

	// Damping：简单线性阻尼系数，越大衰减越快
	// 这里以关节扭矩形式 -c * theta_dot 加到 p_dot 里
	Damping float64
}
