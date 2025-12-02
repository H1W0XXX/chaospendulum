package pendulum

// StepRK4 对 y 做一步 RK4 积分
// y: [theta1, p1, theta2, p2]
func StepRK4(y []float64, p *Params, dt float64) {
	if len(y) < 4 {
		return
	}

	k1 := make([]float64, 4)
	k2 := make([]float64, 4)
	k3 := make([]float64, 4)
	k4 := make([]float64, 4)
	tmp := make([]float64, 4)

	// k1
	DerivCompound(y, p, k1)

	// k2
	for i := 0; i < 4; i++ {
		tmp[i] = y[i] + 0.5*dt*k1[i]
	}
	DerivCompound(tmp, p, k2)

	// k3
	for i := 0; i < 4; i++ {
		tmp[i] = y[i] + 0.5*dt*k2[i]
	}
	DerivCompound(tmp, p, k3)

	// k4
	for i := 0; i < 4; i++ {
		tmp[i] = y[i] + dt*k3[i]
	}
	DerivCompound(tmp, p, k4)

	// 更新 y
	f := dt / 6.0
	for i := 0; i < 4; i++ {
		y[i] += f * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i])
	}
}
