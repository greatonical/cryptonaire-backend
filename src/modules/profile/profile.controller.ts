import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@UseGuards(JwtAuthGuard)
@Controller('me/profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  me(@CurrentUser() user: any) {
    return this.profile.getMyProfile(user.uid);
  }

  @Put()
  update(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.profile.updateMyProfile(user.uid, dto);
  }
}