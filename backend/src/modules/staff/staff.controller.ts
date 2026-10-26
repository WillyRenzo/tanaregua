import { z } from 'zod';
import { API_TAGS, ApiProblem, ApiResult } from '../../common/http/openapi.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  roleSchema,
  scheduleIntervalSchema,
  staffMemberSchema,
  timeOffSchema,
} from '../registry.responses.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../../common/auth/decorators.js';
import {
  createStaffSchema,
  createTimeOffSchema,
  replaceScheduleSchema,
  timeOffRangeSchema,
  updateStaffSchema,
  type CreateStaffInput,
  type CreateTimeOffInput,
  type ReplaceScheduleInput,
  type TimeOffRange,
  type UpdateStaffInput,
} from './staff.schemas.js';
import { StaffService } from './staff.service.js';

@ApiTags(API_TAGS.staff[0])
@Controller()
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @RequirePermissions('staff:read')
  @ApiResult(z.array(roleSchema))
  @ApiOperation({ summary: 'Lista os papéis da barbearia' })
  @Get('roles')
  listRoles() {
    return this.staff.listRoles();
  }

  @RequirePermissions('staff:read')
  @ApiResult(z.array(staffMemberSchema))
  @ApiOperation({ summary: 'Lista a equipe' })
  @Get('staff')
  list() {
    return this.staff.list();
  }

  @RequirePermissions('staff:manage')
  @ApiResult(staffMemberSchema, 201)
  @ApiOperation({ summary: 'Cadastra funcionário' })
  @ApiProblem(409, 'already-member', 'A pessoa já faz parte da equipe.')
  @Post('staff')
  create(@Body({ schema: createStaffSchema }) input: CreateStaffInput) {
    return this.staff.create(input);
  }

  @RequirePermissions('staff:manage')
  @ApiResult(staffMemberSchema)
  @ApiOperation({ summary: 'Altera papel, atendimento ou status' })
  @ApiProblem(
    422,
    'cannot-change-self | invalid-role',
    'Alterar o próprio papel/status ou papel inexistente.',
  )
  @Patch('staff/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateStaffSchema }) input: UpdateStaffInput,
  ) {
    return this.staff.update(id, input);
  }

  @RequirePermissions('staff:read')
  @ApiResult(z.array(scheduleIntervalSchema))
  @ApiOperation({ summary: 'Expediente semanal' })
  @Get('staff/:id/schedule')
  getSchedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.getSchedule(id);
  }

  @RequirePermissions('staff:manage')
  @ApiResult(z.array(scheduleIntervalSchema))
  @ApiOperation({ summary: 'Substitui o expediente semanal' })
  @Put('staff/:id/schedule')
  replaceSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: replaceScheduleSchema }) input: ReplaceScheduleInput,
  ) {
    return this.staff.replaceSchedule(id, input);
  }

  @RequirePermissions('staff:read')
  @ApiResult(z.array(timeOffSchema))
  @ApiOperation({ summary: 'Folgas e bloqueios no período' })
  @Get('staff/:id/time-offs')
  listTimeOffs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: timeOffRangeSchema }) range: TimeOffRange,
  ) {
    return this.staff.listTimeOffs(id, range);
  }

  @RequirePermissions('staff:manage')
  @ApiResult(timeOffSchema, 201)
  @ApiOperation({ summary: 'Registra folga ou bloqueio' })
  @Post('staff/:id/time-offs')
  createTimeOff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: createTimeOffSchema }) input: CreateTimeOffInput,
  ) {
    return this.staff.createTimeOff(id, input);
  }

  @RequirePermissions('staff:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove folga ou bloqueio' })
  @Delete('staff/:id/time-offs/:timeOffId')
  deleteTimeOff(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('timeOffId', ParseUUIDPipe) timeOffId: string,
  ) {
    return this.staff.deleteTimeOff(id, timeOffId);
  }
}
